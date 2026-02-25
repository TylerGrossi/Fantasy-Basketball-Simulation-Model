"""
Fantasy Basketball Simulator - Custom CSS styles for Streamlit app.
"""

CUSTOM_CSS = """
<style>
    @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Roboto+Condensed:wght@300;400;700&display=swap');
    @import url('https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css');
    
    /* Hide anchor link icons */
    .stMarkdown a[href^="#"]::after,
    h1 a, h2 a, h3 a, h4 a, h5 a, h6 a,
    [data-testid="stHeaderActionElements"],
    .stMarkdown h1 a, .stMarkdown h2 a, .stMarkdown h3 a {
        display: none !important;
        visibility: hidden !important;
    }
    
    a.anchor-link {
        display: none !important;
    }
    
    :root {
        --primary: #FF6B35;
        --secondary: #1A1A2E;
        --accent: #00D4FF;
        --success: #00FF88;
        --danger: #FF4757;
        --bg-dark: #0F0F1A;
        --card-bg: #1A1A2E;
    }
    
    .stApp {
        background: linear-gradient(135deg, #0F0F1A 0%, #1A1A2E 50%, #0F0F1A 100%);
    }
    
    h1, h2, h3 {
        font-family: 'Oswald', sans-serif !important;
        text-transform: uppercase;
        letter-spacing: 2px;
    }
    
    .main-header {
        background: linear-gradient(90deg, #FF6B35, #FF8C42, #FFD93D);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        font-size: 3.5rem !important;
        font-weight: 700;
        text-align: center;
        padding: 1rem 0;
        margin-bottom: 1rem;
    }
    
    .stat-card {
        background: linear-gradient(145deg, #1A1A2E, #252545);
        border-radius: 16px;
        padding: 1.5rem;
        border: 1px solid rgba(255, 107, 53, 0.3);
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
        transition: transform 0.3s ease, box-shadow 0.3s ease;
    }
    
    .stat-card:hover {
        transform: translateY(-4px);
        box-shadow: 0 12px 40px rgba(255, 107, 53, 0.2);
    }
    
    .win-pct {
        font-family: 'Oswald', sans-serif;
        font-size: 4rem;
        font-weight: 700;
        text-align: center;
    }
    
    .win-pct.winning {
        color: #00FF88;
        text-shadow: 0 0 30px rgba(0, 255, 136, 0.5);
    }
    
    .win-pct.losing {
        color: #FF4757;
        text-shadow: 0 0 30px rgba(255, 71, 87, 0.5);
    }
    
    .category-row {
        display: flex;
        justify-content: space-between;
        padding: 0.5rem 0;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }
    
    .swing-badge {
        background: linear-gradient(90deg, #FFD93D, #FF6B35);
        color: #0F0F1A;
        padding: 2px 8px;
        border-radius: 4px;
        font-size: 0.7rem;
        font-weight: 700;
        text-transform: uppercase;
    }
    
    .streamer-card {
        background: linear-gradient(145deg, #252545, #1A1A2E);
        border-radius: 12px;
        padding: 1rem;
        margin: 0.5rem 0;
        border-left: 4px solid #00D4FF;
    }
    
    .streamer-card.positive {
        border-left-color: #00FF88;
    }
    
    .streamer-card.negative {
        border-left-color: #FF4757;
    }
    
    /* Sidebar styling */
    [data-testid="stSidebar"] {
        background: linear-gradient(180deg, #1A1A2E 0%, #0F0F1A 100%);
    }
    
    [data-testid="stSidebar"] h1 {
        color: #FF6B35;
    }
    
    /* Button styling */
    .stButton > button {
        background: linear-gradient(90deg, #FF6B35, #FF8C42) !important;
        color: white !important;
        font-family: 'Oswald', sans-serif !important;
        font-weight: 600 !important;
        text-transform: uppercase !important;
        letter-spacing: 1px !important;
        border: none !important;
        padding: 0.75rem 2rem !important;
        border-radius: 8px !important;
        transition: all 0.3s ease !important;
    }
    
    .stButton > button:hover {
        transform: scale(1.02);
        box-shadow: 0 8px 25px rgba(255, 107, 53, 0.4) !important;
    }
    
    /* Progress bars */
    .stProgress > div > div {
        background: linear-gradient(90deg, #00FF88, #00D4FF) !important;
    }
    
    /* Metrics */
    [data-testid="stMetricValue"] {
        font-family: 'Oswald', sans-serif !important;
        font-size: 2rem !important;
    }
    
    /* Center metrics */
    [data-testid="stMetric"] {
        text-align: center;
    }
    
    [data-testid="stMetricLabel"] {
        display: flex;
        justify-content: center;
    }
    
    /* Make metric value and delta inline */
    [data-testid="stMetric"] > div {
        display: flex;
        flex-direction: row;
        align-items: baseline;
        justify-content: center;
        gap: 0.5rem;
    }
    
    [data-testid="stMetricValue"] {
        display: flex;
        justify-content: center;
    }
    
    [data-testid="stMetricDelta"] {
        font-size: 0.9rem !important;
    }
    
    /* Expander */
    .streamlit-expanderHeader {
        font-family: 'Oswald', sans-serif !important;
        text-transform: uppercase !important;
    }
    
    /* Tables */
    .dataframe {
        font-family: 'Roboto Condensed', sans-serif !important;
    }
    
    /* Info boxes / success / warning / error bars - rounded corners, no gap */
    .stAlert,
    [data-testid="stAlert"] {
        border-radius: 12px !important;
        overflow: hidden !important;
        padding: 0 !important;
        border: 1px solid rgba(255, 107, 53, 0.3) !important;
        background: rgba(26, 26, 46, 0.9) !important;
    }
    .stAlert > div,
    [data-testid="stAlert"] > div {
        margin: 0 !important;
        border: none !important;
        border-radius: 0 !important;
        padding: 0.75rem 1rem !important;
    }
    /* Remove gap from any nested inner (e.g. green success box) */
    .stAlert > div > div,
    [data-testid="stAlert"] > div > div {
        margin: 0 !important;
        border-radius: 0 !important;
    }
    
    /* Mobile responsive card */
    .mobile-card {
        background: linear-gradient(145deg, #252545, #1A1A2E);
        border-radius: 12px;
        padding: 1rem;
        margin-bottom: 1rem;
        border-left: 4px solid #00D4FF;
    }
    
    /* Responsive scoreboard table */
    .scoreboard-table {
        width: 100%;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
    }
    
    /* ========================================
       MOBILE RESPONSIVE STYLES
       ======================================== */
    
    /* Tablets and smaller (max-width: 992px) */
    @media screen and (max-width: 992px) {
        .main-header {
            font-size: 2.5rem !important;
        }
        
        [data-testid="stMetricValue"] {
            font-size: 1.5rem !important;
        }
    }
    
    /* Mobile devices (max-width: 768px) */
    @media screen and (max-width: 768px) {
        .main-header {
            font-size: 1.8rem !important;
            letter-spacing: 1px;
        }
        
        h2 {
            font-size: 1.3rem !important;
        }
        
        h3 {
            font-size: 1.1rem !important;
        }
        
        .win-pct {
            font-size: 2.5rem;
        }
        
        [data-testid="stMetricValue"] {
            font-size: 1.3rem !important;
        }
        
        .stat-card {
            padding: 1rem;
            border-radius: 12px;
        }
        
        /* Stack columns on mobile */
        [data-testid="column"] {
            width: 100% !important;
            flex: 1 1 100% !important;
        }
        
        /* Smaller table fonts on mobile */
        .dataframe {
            font-size: 0.75rem !important;
        }
        
        .dataframe th, .dataframe td {
            padding: 4px 6px !important;
        }
        
        /* Adjust plotly charts for mobile */
        .js-plotly-plot {
            max-width: 100% !important;
        }
        
        /* Mobile scoreboard adjustments */
        .scoreboard-table table {
            font-size: 0.7rem;
        }
        
        .scoreboard-table th, .scoreboard-table td {
            padding: 4px 2px !important;
        }
    }
    
    /* Small mobile devices (max-width: 480px) */
    @media screen and (max-width: 480px) {
        .main-header {
            font-size: 1.4rem !important;
            letter-spacing: 0.5px;
        }
        
        h2 {
            font-size: 1.1rem !important;
        }
        
        h3 {
            font-size: 1rem !important;
        }
        
        .win-pct {
            font-size: 2rem;
        }
        
        [data-testid="stMetricValue"] {
            font-size: 1.1rem !important;
        }
        
        /* Hide less important columns on very small screens */
        .hide-mobile {
            display: none !important;
        }
        
        .dataframe {
            font-size: 0.65rem !important;
        }
        
        /* Compact button on mobile */
        .stButton > button {
            padding: 0.5rem 1rem !important;
            font-size: 0.9rem !important;
        }
    }
    
    /* Ensure horizontal scroll for wide tables */
    [data-testid="stDataFrame"] {
        overflow-x: auto !important;
    }
    
    [data-testid="stDataFrame"] > div {
        overflow-x: auto !important;
        -webkit-overflow-scrolling: touch;
    }
</style>
"""
