"""
Fantasy Basketball Simulator - Charts and scoreboard HTML.
"""

import plotly.graph_objects as go

from config import CATEGORIES


def create_scoreboard(current_you, current_opp, your_team_name, opp_team_name):
    """Create a scoreboard showing current week stats."""
    categories_order = ["FGM", "FGA", "FG%", "FT%", "3PM", "3PA", "3P%", "REB", "AST", "STL", "BLK", "TO", "DD", "PTS", "TW"]
    your_fgp = current_you["FGM"] / current_you["FGA"] if current_you["FGA"] > 0 else 0
    opp_fgp = current_opp["FGM"] / current_opp["FGA"] if current_opp["FGA"] > 0 else 0
    your_ftp = current_you["FTM"] / current_you["FTA"] if current_you["FTA"] > 0 else 0
    opp_ftp = current_opp["FTM"] / current_opp["FTA"] if current_opp["FTA"] > 0 else 0
    your_3pp = current_you["3PM"] / current_you["3PA"] if current_you["3PA"] > 0 else 0
    opp_3pp = current_opp["3PM"] / current_opp["3PA"] if current_opp["3PA"] > 0 else 0
    your_stats = {
        "FGM": current_you["FGM"], "FGA": current_you["FGA"], "FG%": your_fgp,
        "FT%": your_ftp, "3PM": current_you["3PM"], "3PA": current_you["3PA"], "3P%": your_3pp,
        "REB": current_you["REB"], "AST": current_you["AST"], "STL": current_you["STL"],
        "BLK": current_you["BLK"], "TO": current_you["TO"], "DD": current_you["DD"],
        "PTS": current_you["PTS"], "TW": current_you["TW"]
    }
    opp_stats = {
        "FGM": current_opp["FGM"], "FGA": current_opp["FGA"], "FG%": opp_fgp,
        "FT%": opp_ftp, "3PM": current_opp["3PM"], "3PA": current_opp["3PA"], "3P%": opp_3pp,
        "REB": current_opp["REB"], "AST": current_opp["AST"], "STL": current_opp["STL"],
        "BLK": current_opp["BLK"], "TO": current_opp["TO"], "DD": current_opp["DD"],
        "PTS": current_opp["PTS"], "TW": current_opp["TW"]
    }
    your_wins = 0
    opp_wins = 0
    ties = 0
    for cat in categories_order:
        y_val = your_stats[cat]
        o_val = opp_stats[cat]
        if cat == "TO":
            if y_val < o_val:
                your_wins += 1
            elif y_val > o_val:
                opp_wins += 1
            else:
                ties += 1
        else:
            if y_val > o_val:
                your_wins += 1
            elif y_val < o_val:
                opp_wins += 1
            else:
                ties += 1
    header_cells = '<th style="padding: 8px 4px; text-align: left; color: #888; font-size: 0.75rem;">TEAM</th>'
    for cat in categories_order:
        header_cells += f'<th style="padding: 8px 4px; text-align: center; color: #888; font-size: 0.75rem;">{cat}</th>'
    header_cells += '<th style="padding: 8px 4px; text-align: center; color: #888; font-size: 0.75rem;">SCORE</th>'
    your_cells = f'<td style="padding: 10px 4px; color: white; font-weight: 600;">{your_team_name[:15]}</td>'
    for cat in categories_order:
        y_val = your_stats[cat]
        o_val = opp_stats[cat]
        if cat == "TO":
            color = "#00FF88" if y_val < o_val else "#FF4757" if y_val > o_val else "white"
        else:
            color = "#00FF88" if y_val > o_val else "#FF4757" if y_val < o_val else "white"
        val_str = f"{y_val:.4f}" if "%" in cat else str(int(y_val))
        your_cells += f'<td style="padding: 10px 4px; text-align: center; color: {color}; font-weight: 600;">{val_str}</td>'
    your_cells += f'<td style="padding: 10px 4px; text-align: center; color: #00FF88; font-weight: 700; font-family: Oswald;">{your_wins}-{opp_wins}-{ties}</td>'
    opp_cells = f'<td style="padding: 10px 4px; color: white; font-weight: 600;">{opp_team_name[:15]}</td>'
    for cat in categories_order:
        y_val = your_stats[cat]
        o_val = opp_stats[cat]
        if cat == "TO":
            color = "#00FF88" if o_val < y_val else "#FF4757" if o_val > y_val else "white"
        else:
            color = "#00FF88" if o_val > y_val else "#FF4757" if o_val < y_val else "white"
        val_str = f"{o_val:.4f}" if "%" in cat else str(int(o_val))
        opp_cells += f'<td style="padding: 10px 4px; text-align: center; color: {color}; font-weight: 600;">{val_str}</td>'
    opp_cells += f'<td style="padding: 10px 4px; text-align: center; color: #FF4757; font-weight: 700; font-family: Oswald;">{opp_wins}-{your_wins}-{ties}</td>'
    html = f"""
    <div style="margin-bottom: 1.5rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
            <div style="text-align: left; flex: 1;">
                <span style="font-family: Oswald; font-size: 1.5rem; color: white;">{your_team_name}</span>
            </div>
            <div style="text-align: center; flex: 1;">
                <span style="font-family: Oswald; font-size: 2.5rem; color: #00FF88;">{your_wins}-{opp_wins}-{ties}</span>
                <span style="font-family: Oswald; font-size: 1.2rem; color: #666; margin-left: 2rem;">{opp_wins}-{your_wins}-{ties}</span>
            </div>
            <div style="text-align: right; flex: 1;">
                <span style="font-family: Oswald; font-size: 1.5rem; color: white;">{opp_team_name}</span>
            </div>
        </div>
        <div style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse; font-family: Roboto Condensed;">
                <thead>
                    <tr style="border-bottom: 1px solid rgba(255,255,255,0.2);">
                        {header_cells}
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        {your_cells}
                    </tr>
                    <tr>
                        {opp_cells}
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
    """
    return html


def create_win_probability_gauge(win_pct):
    """Create a gauge chart for win probability."""
    fig = go.Figure(go.Indicator(
        mode="gauge+number",
        value=win_pct,
        domain={'x': [0, 1], 'y': [0, 1]},
        number={'suffix': '%', 'font': {'size': 60, 'family': 'Oswald', 'color': 'white'}},
        gauge={
            'axis': {'range': [0, 100], 'tickwidth': 1, 'tickcolor': "white"},
            'bar': {'color': "#00FF88" if win_pct >= 50 else "#FF4757"},
            'bgcolor': "rgba(0,0,0,0)",
            'borderwidth': 2,
            'bordercolor': "rgba(255,255,255,0.3)",
            'steps': [
                {'range': [0, 40], 'color': 'rgba(255, 71, 87, 0.3)'},
                {'range': [40, 60], 'color': 'rgba(255, 217, 61, 0.3)'},
                {'range': [60, 100], 'color': 'rgba(0, 255, 136, 0.3)'}
            ],
            'threshold': {
                'line': {'color': "white", 'width': 4},
                'thickness': 0.75,
                'value': win_pct
            }
        }
    ))
    fig.update_layout(
        paper_bgcolor='rgba(0,0,0,0)',
        plot_bgcolor='rgba(0,0,0,0)',
        font={'color': 'white', 'family': 'Oswald'},
        height=300,
        margin=dict(l=30, r=30, t=30, b=30)
    )
    return fig


def create_category_chart(category_results, your_sim, opp_sim):
    """Create horizontal bar chart for category win rates."""
    cats = []
    you_pcts = []
    opp_pcts = []
    for cat in reversed(CATEGORIES):
        outcome = category_results[cat]
        total = sum(outcome.values())
        you_pcts.append(outcome["you"] / total * 100)
        opp_pcts.append(outcome["opponent"] / total * 100)
        cats.append(cat)
    fig = go.Figure()
    fig.add_trace(go.Bar(
        name='You',
        y=cats,
        x=you_pcts,
        orientation='h',
        marker_color='#00FF88',
        text=[f'{p:.0f}%' for p in you_pcts],
        textposition='inside',
        textfont=dict(family='Oswald', size=12, color='black')
    ))
    fig.add_trace(go.Bar(
        name='Opponent',
        y=cats,
        x=[-p for p in opp_pcts],
        orientation='h',
        marker_color='#FF4757',
        text=[f'{p:.0f}%' for p in opp_pcts],
        textposition='inside',
        textfont=dict(family='Oswald', size=12, color='white')
    ))
    fig.update_layout(
        barmode='overlay',
        paper_bgcolor='rgba(0,0,0,0)',
        plot_bgcolor='rgba(0,0,0,0)',
        font={'color': 'white', 'family': 'Roboto Condensed'},
        height=500,
        margin=dict(l=60, r=60, t=20, b=20),
        xaxis=dict(
            range=[-100, 100],
            showgrid=True,
            gridcolor='rgba(255,255,255,0.1)',
            zeroline=True,
            zerolinecolor='white',
            zerolinewidth=2,
            tickvals=[-100, -75, -50, -25, 0, 25, 50, 75, 100],
            ticktext=['100%', '75%', '50%', '25%', '0', '25%', '50%', '75%', '100%']
        ),
        yaxis=dict(showgrid=False),
        legend=dict(orientation='h', yanchor='bottom', y=1.02, xanchor='center', x=0.5),
        showlegend=True
    )
    return fig


def create_outcome_distribution(outcome_counts, total_sims):
    """Create chart showing distribution of score outcomes."""
    sorted_outcomes = sorted(outcome_counts.items(), key=lambda x: x[1], reverse=True)[:10]
    labels = [f"{your_w}-{opp_w}" for (your_w, opp_w), _ in sorted_outcomes]
    values = [count / total_sims * 100 for _, count in sorted_outcomes]
    colors = ['#00FF88' if your_w > opp_w else '#FF4757' if opp_w > your_w else '#FFD93D'
              for (your_w, opp_w), _ in sorted_outcomes]
    fig = go.Figure(data=[
        go.Bar(
            x=labels,
            y=values,
            marker_color=colors,
            text=[f'{v:.1f}%' for v in values],
            textposition='outside',
            textfont=dict(family='Oswald', size=12, color='white'),
            cliponaxis=False
        )
    ])
    max_val = max(values) if values else 50
    y_max = max_val * 1.2
    fig.update_layout(
        paper_bgcolor='rgba(0,0,0,0)',
        plot_bgcolor='rgba(0,0,0,0)',
        font={'color': 'white', 'family': 'Roboto Condensed'},
        height=300,
        margin=dict(l=40, r=40, t=50, b=60),
        xaxis=dict(
            title='Score Outcome (You - Opponent)',
            showgrid=False,
            tickfont=dict(family='Oswald', size=12),
            type='category'
        ),
        yaxis=dict(
            title='Probability',
            showgrid=True,
            gridcolor='rgba(255,255,255,0.1)',
            ticksuffix='%',
            range=[0, y_max]
        )
    )
    return fig
