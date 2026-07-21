"""
Gemini-powered chat assistant (free Google AI Studio tier).

This module is the thin LLM layer only: it creates a Gemini chat with *automatic
function calling* and relays messages. The actual "tools" (the functions that read the
league data) live in streamlit_app.py next to the data functions they wrap, and are
passed in here as plain Python callables — the Gemini SDK builds the tool schema from
their signatures + docstrings and executes them itself during a turn.

Free-tier quotas are small and per-model, so everything here rotates through a fallback
chain of models (config.GEMINI_MODELS): when one model returns HTTP 429 (its daily/RPM
quota is spent) the assistant moves to the next model, preserving the conversation. Only
when *every* model is exhausted does the user see a rate-limit message.

Design intent (see AGENTS.md): the LLM never does the basketball math. It picks which
tool to call, our cached Python returns the real numbers, and Gemini narrates a
recommendation grounded in those numbers.
"""

from datetime import datetime
from zoneinfo import ZoneInfo

from google import genai
from google.genai import types, errors

from config import GEMINI_API_KEY, GEMINI_MODELS

_client = None


def get_client():
    """One shared Gemini client for the process (cheap; holds the API key)."""
    global _client
    if _client is None:
        _client = genai.Client(api_key=GEMINI_API_KEY)
    return _client


def _is_rate_limit(e):
    return isinstance(e, errors.ClientError) and getattr(e, "code", None) == 429


class AssistantBusy(Exception):
    """Transient Gemini overload (503) that survived our retries."""


class AssistantRateLimited(Exception):
    """Every model in the fallback chain is out of free-tier quota (429)."""


def build_system_instruction(team_name):
    """League context + ground rules. Keeps answers grounded in tool output."""
    today = datetime.now(ZoneInfo("America/New_York")).strftime("%A, %B %d, %Y")
    return (
        f"Today's date is {today}. This is authoritative - your own training data is older "
        "than this, so anything that could have happened or changed since your training "
        "(game/series results, awards, standings, rosters, coaches, records, 'who is the "
        "current...') is something you must VERIFY with web_search rather than answer from "
        "memory. If you catch yourself about to say an event 'hasn't happened yet', stop and "
        "web_search it first - it very likely already has.\n\n"
        "You are a concise, knowledgeable fantasy basketball assistant for an ESPN "
        f'9-category head-to-head league. The user\'s team is "{team_name}".\n\n'
        "Scoring categories: FG%, FT%, 3PM, REB, AST, STL, BLK, TO (turnovers - LOWER is "
        "better), PTS, and double-doubles (DD). \"Value\" is a 9-category z-score rating: "
        "higher is better, ~0 is replacement level, and positive means a useful fantasy "
        "player. A player's \"15-day\" / \"30-day\" trend is how their recent value compares "
        "to their season value (positive = heating up, negative = cooling off).\n\n"
        "You are the user's competitive edge - a sharp, proactive basketball analyst AND a "
        "full basketball expert. You can and should answer ANY basketball question the user "
        "asks: their fantasy league, the real NBA (current and historical), players, teams, "
        "coaches, rules, strategy, scheme, terminology, records, awards, the draft, the "
        "G-League, college, international/EuroLeague, and history. NEVER refuse or deflect a "
        "basketball question, and never say you can 'only' help with the fantasy league - if "
        "you're unsure, use web_search and then answer.\n\n"
        "You have two sources of truth on top of your own basketball knowledge:\n"
        "1. LEAGUE DATA tools (lookup_player, list_players, compare_players, "
        "team_category_ranks, team_roster, list_teams, power_rankings) - use these for "
        "anything about THIS fantasy league's players, rosters, values, or standings. ALWAYS "
        "call them for real league numbers; never invent a value, stat, or roster.\n"
        "2. web_search (Google) - use this LIBERALLY for anything the league data can't "
        "answer and anything current or that you're not fully certain of: live news, "
        "injuries, trades, standings, scores, schedules, awards, rosters, coaching changes, "
        "records, or a fact you want to confirm. When in doubt, search before answering.\n\n"
        "For general basketball knowledge (rules, strategy, terminology, well-established "
        "history) you may answer directly from your own expertise; verify with web_search if "
        "the detail is specific, recent, or uncertain. Call multiple tools when useful (e.g. "
        "lookup_player AND web_search their injury status).\n\n"
        "TRADE REALISM - this matters. Fantasy value is a z-score, but real trades are NOT "
        "just about matching total value. Elite, top-tier players (roughly the top ~15-20 in "
        "the league, and especially the top 5) carry a large scarcity PREMIUM: their owner "
        "will almost never trade them for a package of two or more clearly lesser players, "
        "even if the raw values add up, because one elite player is far more valuable than "
        "two good ones (roster spots are scarce, and you can't start everyone). To acquire a "
        "top-tier star you must give up a comparable star or a genuine overpay that still "
        "centers on a strong player - never suggest landing a top-5 player for two mid-tier "
        "or role players. When proposing trades, respect this: match star-for-star, and be "
        "honest that a lopsided 'two-for-one for a superstar' offer would be rejected.\n\n"
        "Be concise and opinionated: give a clear recommendation and cite the concrete "
        "value, stat, or source that backs it - don't just dump data. Use markdown (bold, "
        "short lists) for readability. This past NBA season's league numbers are final; use "
        "web_search for anything current."
    )


class AssistantChat:
    """A stateful chat that automatically rotates through GEMINI_MODELS on rate limits.

    Holds the committed conversation history itself, so when a model runs out of quota it
    can recreate the underlying chat on the next model *from the same history* and retry
    the turn — no lost context, no duplicated messages.
    """

    def __init__(self, tool_fns, system_instruction, models=None):
        self.tool_fns = list(tool_fns)
        self.system_instruction = system_instruction
        self.models = list(models or GEMINI_MODELS)
        self.idx = 0
        self._history = []          # committed history (successful turns only)
        self._chat = None
        self._new_chat()

    @property
    def model(self):
        return self.models[self.idx]

    def _config(self):
        return types.GenerateContentConfig(
            system_instruction=self.system_instruction,
            tools=self.tool_fns,
            temperature=0.4,
            # A tool-heavy question (e.g. a trade: look up two rosters, compare players,
            # maybe web_search) can need many tool round-trips; the default cap of 10 can
            # cut it off with an unresolved tool call and no answer.
            automatic_function_calling=types.AutomaticFunctionCallingConfig(
                maximum_remote_calls=20),
        )

    def _new_chat(self):
        """(Re)build the underlying chat on the current model from committed history."""
        self._chat = get_client().chats.create(
            model=self.model, history=list(self._history), config=self._config())

    def _commit(self):
        try:
            self._history = self._chat.get_history()
        except Exception:
            pass

    def _rotate(self):
        """Advance to the next model (rebuilding from committed history). False if none."""
        if self.idx + 1 >= len(self.models):
            return False
        self.idx += 1
        self._new_chat()
        return True

    def _reset_to_primary(self):
        """Start each new turn from the top of the chain. Rate limits are mostly per-minute
        (and per-day), so a model that was exhausted earlier is very often available again -
        without this, the chain would stay stuck on whatever late/exhausted model a previous
        turn ended on and could raise 'rate limited' even while earlier models are free."""
        if self.idx != 0:
            self.idx = 0
            self._new_chat()

    def stream(self, message):
        """Yield the reply token-by-token, rotating models on 429 and retrying 503.

        A 429/503 that hits *before* any text is produced is recoverable (rotate model or
        back off, then retry the turn from committed history). Once text has streamed we
        can't safely restart, so we stop and keep what we have.
        """
        self._reset_to_primary()
        saw_rate_limit = False
        while True:
            produced = False
            try:
                for chunk in self._chat.send_message_stream(message):
                    if chunk.text:
                        produced = True
                        yield chunk.text
                if produced:
                    self._commit()
                    return
                # Streamed no text (some models emit none while calling tools). Retry the
                # turn non-streamed from committed history to get the final answer.
                self._new_chat()
                resp = self._chat.send_message(message)
                try:
                    text = (resp.text or "").strip()
                except Exception:
                    text = ""
                if text:
                    self._commit()
                    yield text
                    return
                # Still empty (a lite model can return an unresolved tool call and give up):
                # fall through and rotate to the next model.
            except errors.ClientError as e:
                if produced:            # error after partial output - keep what streamed
                    self._commit()
                    return
                if _is_rate_limit(e):
                    saw_rate_limit = True
                # any client error (429, 400, ...) -> fall through to try the next model
            except Exception:
                # server error / timeout / unexpected model-or-tool error -> next model
                if produced:
                    self._commit()
                    return
            # This model didn't produce an answer - rotate to the next one in the chain.
            if not self._rotate():
                break
        if saw_rate_limit:
            raise AssistantRateLimited()
        yield ("I couldn't reach a working model for that one right now. Please try again "
               "in a moment.")

    def send(self, message):
        """Non-streaming send; rotates past any per-model failure, returns text."""
        self._reset_to_primary()
        saw_rate_limit = False
        while True:
            try:
                resp = self._chat.send_message(message)
                try:
                    text = (resp.text or "").strip()
                except Exception:
                    text = ""
                if text:
                    self._commit()
                    return text
            except errors.ClientError as e:
                if _is_rate_limit(e):
                    saw_rate_limit = True
            except Exception:
                pass
            if not self._rotate():
                break
        if saw_rate_limit:
            raise AssistantRateLimited()
        return ("I couldn't reach a working model for that one right now. Please try again "
                "in a moment.")


def create_chat(tool_fns, system_instruction):
    """Create a model-rotating chat over the given tool callables."""
    return AssistantChat(tool_fns, system_instruction)


def stream_message(chat, message):
    """Generator of reply text chunks (delegates to the chat's model-rotating stream)."""
    return chat.stream(message)


def send_message(chat, message):
    """Full reply text (delegates to the chat's model-rotating send)."""
    return chat.send(message)


def web_search(query: str) -> str:
    """Search the live web (Google) for real-world basketball information the league data
    can't answer: current NBA news, injuries, trades, the offseason, standings, awards,
    schedules, or general basketball facts. Use this whenever the question is about the
    real NBA rather than this fantasy league's own player pool.

    Args:
        query: A focused web search query (e.g. "LeBron James injury status today").
    """
    # Google Search grounding can't be combined with function calling in one request, so
    # this runs as its OWN isolated grounded call — the model's function-calling chat sees
    # this as a normal tool, and we tap Google underneath it. Rotates models on 429 too.
    client = get_client()
    cfg = types.GenerateContentConfig(
        tools=[types.Tool(google_search=types.GoogleSearch())], temperature=0.2)
    resp = None
    for model in GEMINI_MODELS:
        try:
            resp = client.models.generate_content(model=model, contents=query, config=cfg)
            break
        except Exception as e:
            if _is_rate_limit(e):
                continue                # this model is out of quota; try the next
            return "Web search is unavailable right now."
    if resp is None:
        return "Web search is rate-limited right now - try again in a bit."
    text = (resp.text or "").strip()
    cites = []
    try:
        for cand in resp.candidates or []:
            gm = getattr(cand, "grounding_metadata", None)
            for ch in (getattr(gm, "grounding_chunks", None) or []):
                w = getattr(ch, "web", None)
                title = getattr(w, "title", None) if w else None
                if title and title not in cites:
                    cites.append(title)
    except Exception:
        pass
    if not text:
        return f'No clear web result found for "{query}".'
    if cites:
        text += "\n\nSources: " + ", ".join(cites[:4])
    return text
