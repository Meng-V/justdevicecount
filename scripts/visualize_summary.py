#!/usr/bin/env python3
"""
visualize_summary.py — Interactive Plotly dashboard for patron analytics.

Reads stored_data/analysis/big_summary.json (produced by big_summary.py)
and generates a self-contained HTML dashboard:

    stored_data/analysis/dashboard.html

Open the HTML file in any browser — no server required.

Sections rendered
-----------------
1.  Overview cards  — all-time avg / peak / low / months covered
2.  Monthly avg & peak bars — side-by-side comparison
3.  Top-10 vs Bottom-10 days (cross-month) — horizontal bar race chart
4.  Day-of-week heatmap — avg patrons Mon→Sun across all months
5.  Hourly heatmap (ET) — avg by hour × month
6.  Hourly line chart (all months combined) — with peak overlay
7.  Floor comparison bar chart — avg patrons per floor per month
8.  Floor peak hours radar chart — which hours each floor peaks
9.  Drill-down: select a month → see its full daily timeline
10. Drill-down: select a month → see its weekday profile
11. Per-month top-10 / bottom-10 day tables

Usage:
    python3 scripts/visualize_summary.py

Flags:
    --analysis-file PATH    path to big_summary.json
                            (default: stored_data/analysis/big_summary.json)
    --output-file   PATH    where to write dashboard.html
                            (default: stored_data/analysis/dashboard.html)
"""

import argparse
import json
import os
import sys

try:
    import plotly.graph_objects as go
    import plotly.express as px
    from plotly.subplots import make_subplots
    import plotly.io as pio
except ImportError:
    print("ERROR: plotly is required.  Install with:  pip3 install plotly pandas")
    sys.exit(1)

try:
    import pandas as pd
except ImportError:
    print("ERROR: pandas is required.  Install with:  pip3 install pandas")
    sys.exit(1)


# ---------------------------------------------------------------------------
# Colour palette
# ---------------------------------------------------------------------------

FLOOR_COLORS = {
    "Ground": "#0066cc",
    "First":  "#20c997",
    "Second": "#ffc107",
    "Third":  "#dc3545",
}
MONTH_PALETTE = px.colors.qualitative.Plotly
PRIMARY   = "#0066cc"
ACCENT    = "#dc3545"
BG_CARD   = "#f8f9fa"
BG_MAIN   = "#ffffff"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def month_label(mk: str) -> str:
    """'2025-10' → 'Oct 2025'"""
    import calendar
    y, m = int(mk[:4]), int(mk[5:])
    return f"{calendar.month_abbr[m]} {y}"


def load(path: str) -> dict:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


# ---------------------------------------------------------------------------
# Individual chart builders
# ---------------------------------------------------------------------------

def fig_monthly_bars(global_data: dict) -> go.Figure:
    """Monthly avg + peak side-by-side bars."""
    overview = global_data["monthly_overview"]
    months   = [month_label(m["month"]) for m in overview]
    avgs     = [m["avg_patrons"]  for m in overview]
    peaks    = [m["peak_patrons"] for m in overview]

    fig = go.Figure()
    fig.add_bar(name="Monthly Avg",  x=months, y=avgs,  marker_color=PRIMARY,
                text=avgs,  textposition="outside")
    fig.add_bar(name="Monthly Peak", x=months, y=peaks, marker_color=ACCENT,
                text=peaks, textposition="outside")
    fig.update_layout(
        title="Monthly Average vs Peak Patron Count",
        barmode="group",
        xaxis_title="Month",
        yaxis_title="Patrons",
        legend=dict(orientation="h", y=1.02, x=1, xanchor="right"),
        plot_bgcolor=BG_CARD,
        paper_bgcolor=BG_MAIN,
    )
    return fig


def fig_top_bottom_days(global_data: dict) -> go.Figure:
    """Horizontal bars — top-10 and bottom-10 days side by side."""
    top    = global_data["cross_month_top10_days"]
    bottom = global_data["cross_month_low10_days"]

    fig = make_subplots(rows=1, cols=2, subplot_titles=["Top 10 Days", "Bottom 10 Days"])

    top_labels = [f"{d['date']} ({d['weekday'][:3]})" for d in top]
    top_avgs   = [d["avg"] for d in top]
    fig.add_trace(
        go.Bar(name="Top 10", x=top_avgs, y=top_labels, orientation="h",
               marker_color=PRIMARY, text=top_avgs, textposition="outside"),
        row=1, col=1
    )

    bot_labels = [f"{d['date']} ({d['weekday'][:3]})" for d in bottom]
    bot_avgs   = [d["avg"] for d in bottom]
    fig.add_trace(
        go.Bar(name="Bottom 10", x=bot_avgs, y=bot_labels, orientation="h",
               marker_color=ACCENT, text=bot_avgs, textposition="outside"),
        row=1, col=2
    )

    fig.update_layout(
        title="All-Time Top-10 & Bottom-10 Days (by daily average patrons)",
        showlegend=False,
        plot_bgcolor=BG_CARD,
        paper_bgcolor=BG_MAIN,
        height=420,
    )
    fig.update_yaxes(autorange="reversed")
    return fig


def fig_weekday_heatmap(months_data: dict, global_data: dict) -> go.Figure:
    """Heatmap: month × weekday, cell = avg patrons."""
    WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday",
                "Friday", "Saturday", "Sunday"]
    sorted_months = sorted(months_data.keys())
    z = []
    for mk in sorted_months:
        wd_map = {wd["weekday"]: wd["avg"]
                  for wd in months_data[mk]["day_of_week"]}
        z.append([wd_map.get(w, 0) for w in WEEKDAYS])

    fig = go.Figure(go.Heatmap(
        z=z,
        x=WEEKDAYS,
        y=[month_label(mk) for mk in sorted_months],
        colorscale="Blues",
        text=[[str(v) for v in row] for row in z],
        texttemplate="%{text}",
        colorbar=dict(title="Avg Patrons"),
    ))
    fig.update_layout(
        title="Average Patrons by Day of Week × Month",
        xaxis_title="Day of Week",
        yaxis_title="Month",
        plot_bgcolor=BG_CARD,
        paper_bgcolor=BG_MAIN,
        height=380,
    )
    return fig


def fig_hourly_heatmap(months_data: dict) -> go.Figure:
    """Heatmap: month × hour (ET), cell = avg patrons."""
    sorted_months = sorted(months_data.keys())
    z = []
    hours = [f"{h:02d}:00" for h in range(24)]
    for mk in sorted_months:
        h_map = {h["label"]: h["avg"] for h in months_data[mk]["hourly_profile"]}
        z.append([h_map.get(label, 0) for label in hours])

    fig = go.Figure(go.Heatmap(
        z=z,
        x=hours,
        y=[month_label(mk) for mk in sorted_months],
        colorscale="Oranges",
        colorbar=dict(title="Avg Patrons"),
    ))
    fig.update_layout(
        title="Average Patrons by Hour of Day (Eastern Time) × Month",
        xaxis_title="Hour ET",
        yaxis_title="Month",
        plot_bgcolor=BG_CARD,
        paper_bgcolor=BG_MAIN,
        height=380,
    )
    return fig


def fig_hourly_line(global_data: dict) -> go.Figure:
    """Combined hourly profile — avg line + peak markers."""
    hp     = global_data["hourly_profile"]
    labels = [h["label"]   for h in hp]
    avgs   = [h["avg"]     for h in hp]
    peaks  = [h["peak"]    for h in hp]

    fig = go.Figure()
    fig.add_scatter(x=labels, y=avgs,  mode="lines+markers",
                    name="Avg Patrons", line=dict(color=PRIMARY, width=2.5),
                    marker=dict(size=6))
    fig.add_scatter(x=labels, y=peaks, mode="markers",
                    name="Peak Reading", marker=dict(color=ACCENT, size=9, symbol="diamond"))
    fig.update_layout(
        title="Hourly Profile (All Months, Eastern Time) — Average & Peak",
        xaxis_title="Hour ET",
        yaxis_title="Patrons",
        legend=dict(orientation="h", y=1.02, x=1, xanchor="right"),
        plot_bgcolor=BG_CARD,
        paper_bgcolor=BG_MAIN,
    )
    return fig


def fig_weekday_bar_global(global_data: dict) -> go.Figure:
    """Global day-of-week bar — avg / peak / low."""
    wdp    = global_data["day_of_week_profile"]
    days   = [w["weekday"] for w in wdp]
    avgs   = [w["avg"]     for w in wdp]
    peaks  = [w["peak"]    for w in wdp]
    lows   = [w["low"]     for w in wdp]

    fig = go.Figure()
    fig.add_bar(name="Avg",  x=days, y=avgs,  marker_color=PRIMARY)
    fig.add_bar(name="Peak", x=days, y=peaks, marker_color=ACCENT)
    fig.add_bar(name="Low",  x=days, y=lows,  marker_color="#6c757d")
    fig.update_layout(
        title="Day-of-Week Profile (All Months Combined)",
        barmode="group",
        xaxis_title="Day",
        yaxis_title="Patrons",
        legend=dict(orientation="h", y=1.02, x=1, xanchor="right"),
        plot_bgcolor=BG_CARD,
        paper_bgcolor=BG_MAIN,
    )
    return fig


def fig_floor_bars(months_data: dict) -> go.Figure:
    """Per-floor avg patrons across months — grouped bars."""
    sorted_months = sorted(months_data.keys())
    month_labels  = [month_label(mk) for mk in sorted_months]

    fig = go.Figure()
    from scripts_viz_utils import FLOOR_LABELS
    for i, floor in enumerate(["Ground", "First", "Second", "Third"]):
        avgs = [
            next((f["avg"] for f in months_data[mk]["floor_breakdown"]
                  if f["floor"] == floor), 0)
            for mk in sorted_months
        ]
        fig.add_bar(
            name=floor, x=month_labels, y=avgs,
            marker_color=FLOOR_COLORS[floor],
            text=avgs, textposition="outside",
        )
    fig.update_layout(
        title="Average Patrons per Floor × Month",
        barmode="group",
        xaxis_title="Month",
        yaxis_title="Avg Patrons",
        legend=dict(orientation="h", y=1.02, x=1, xanchor="right"),
        plot_bgcolor=BG_CARD,
        paper_bgcolor=BG_MAIN,
    )
    return fig


def fig_floor_bars_fixed(months_data: dict) -> go.Figure:
    """Per-floor avg patrons across months (standalone, no import needed)."""
    sorted_months = sorted(months_data.keys())
    month_labels  = [month_label(mk) for mk in sorted_months]

    fig = go.Figure()
    for floor, color in FLOOR_COLORS.items():
        avgs = [
            next((f["avg"] for f in months_data[mk]["floor_breakdown"]
                  if f["floor"] == floor), 0)
            for mk in sorted_months
        ]
        fig.add_bar(
            name=floor, x=month_labels, y=avgs,
            marker_color=color,
            text=avgs, textposition="outside",
        )
    fig.update_layout(
        title="Average Patrons per Floor × Month",
        barmode="group",
        xaxis_title="Month",
        yaxis_title="Avg Patrons",
        legend=dict(orientation="h", y=1.02, x=1, xanchor="right"),
        plot_bgcolor=BG_CARD,
        paper_bgcolor=BG_MAIN,
    )
    return fig


def fig_floor_peak_hours_radar(global_data: dict) -> go.Figure:
    """Radar: each floor's avg by hour forming a closed polygon."""
    floor_bd = global_data["floor_breakdown"]
    hours    = list(range(24))
    hour_lbl = [f"{h:02d}:00" for h in hours] + ["00:00"]   # close the loop

    fig = go.Figure()
    for fl in floor_bd:
        h_map   = {h["hour_et"]: h["avg"] for h in fl["top_hours"]}
        # build full 24-hour profile from global hourly (approximate with floor ratio)
        # We use top_hours to label but won't have all hours — use the global profile
        # Instead: just plot the top-5 hours as a scatter polar
        pass

    # Better: scatter-polar of top-5 hours per floor
    for fl in floor_bd:
        theta  = [f"{h['hour_et']:02d}:00" for h in fl["top_hours"]]
        r      = [h["avg"] for h in fl["top_hours"]]
        fig.add_scatterpolar(
            r=r + [r[0]],
            theta=theta + [theta[0]],
            fill="toself",
            name=fl["floor"],
            line_color=FLOOR_COLORS[fl["floor"]],
            fillcolor=FLOOR_COLORS[fl["floor"]],
            opacity=0.45,
        )
    fig.update_layout(
        title="Floor Peak Hours (Top-5 ET Hours by Average Patrons)",
        polar=dict(angularaxis=dict(direction="clockwise")),
        legend=dict(orientation="h", y=-0.15, x=0.5, xanchor="center"),
        plot_bgcolor=BG_CARD,
        paper_bgcolor=BG_MAIN,
    )
    return fig


def fig_daily_timeline_all(months_data: dict) -> go.Figure:
    """Multi-trace daily avg timeline — one line per month, all on one chart."""
    fig = go.Figure()
    for i, (mk, ma) in enumerate(sorted(months_data.items())):
        days  = [d["date"] for d in ma["all_days"]]
        avgs  = [d["avg"]  for d in ma["all_days"]]
        color = MONTH_PALETTE[i % len(MONTH_PALETTE)]
        fig.add_scatter(
            x=days, y=avgs, mode="lines",
            name=month_label(mk),
            line=dict(color=color, width=1.5),
        )
    fig.update_layout(
        title="Daily Average Patron Count — All Months",
        xaxis_title="Date",
        yaxis_title="Daily Avg Patrons",
        legend=dict(orientation="h", y=1.02, x=1, xanchor="right"),
        plot_bgcolor=BG_CARD,
        paper_bgcolor=BG_MAIN,
        height=420,
    )
    return fig


def fig_monthly_top10_table(months_data: dict) -> go.Figure:
    """Table of top-10 days per month (scrollable via dropdown)."""
    # Build a dict of traces — one per month, only active month visible
    sorted_months = sorted(months_data.keys())
    first_month   = sorted_months[0]

    fig = go.Figure()
    buttons = []

    for mk in sorted_months:
        top10   = months_data[mk]["top10_days"]
        visible = mk == first_month
        fig.add_trace(go.Table(
            header=dict(
                values=["Rank", "Date", "Weekday", "Avg Patrons", "Peak Patrons"],
                fill_color=PRIMARY,
                font=dict(color="white", size=13),
                align="left",
            ),
            cells=dict(
                values=[
                    list(range(1, len(top10) + 1)),
                    [d["date"]    for d in top10],
                    [d["weekday"] for d in top10],
                    [d["avg"]     for d in top10],
                    [d["peak"]    for d in top10],
                ],
                fill_color=[BG_CARD, "white"],
                align="left",
            ),
            visible=visible,
        ))
        # Build button visibility list
        vis = [False] * len(sorted_months)
        vis[sorted_months.index(mk)] = True
        buttons.append(dict(
            label=month_label(mk),
            method="update",
            args=[{"visible": vis},
                  {"title": f"Top-10 Busiest Days — {month_label(mk)}"}],
        ))

    fig.update_layout(
        title=f"Top-10 Busiest Days — {month_label(first_month)}",
        updatemenus=[dict(
            buttons=buttons,
            direction="down",
            x=0.01, y=1.12, xanchor="left",
            showactive=True,
        )],
        paper_bgcolor=BG_MAIN,
        height=420,
    )
    return fig


def fig_monthly_bottom10_table(months_data: dict) -> go.Figure:
    """Table of bottom-10 days per month."""
    sorted_months = sorted(months_data.keys())
    first_month   = sorted_months[0]

    fig = go.Figure()
    buttons = []

    for mk in sorted_months:
        bot10   = months_data[mk]["bottom10_days"]
        visible = mk == first_month
        fig.add_trace(go.Table(
            header=dict(
                values=["Rank", "Date", "Weekday", "Avg Patrons", "Peak Patrons"],
                fill_color=ACCENT,
                font=dict(color="white", size=13),
                align="left",
            ),
            cells=dict(
                values=[
                    list(range(1, len(bot10) + 1)),
                    [d["date"]    for d in bot10],
                    [d["weekday"] for d in bot10],
                    [d["avg"]     for d in bot10],
                    [d["peak"]    for d in bot10],
                ],
                fill_color=[BG_CARD, "white"],
                align="left",
            ),
            visible=visible,
        ))
        vis = [False] * len(sorted_months)
        vis[sorted_months.index(mk)] = True
        buttons.append(dict(
            label=month_label(mk),
            method="update",
            args=[{"visible": vis},
                  {"title": f"Bottom-10 Quietest Days — {month_label(mk)}"}],
        ))

    fig.update_layout(
        title=f"Bottom-10 Quietest Days — {month_label(first_month)}",
        updatemenus=[dict(
            buttons=buttons,
            direction="down",
            x=0.01, y=1.12, xanchor="left",
            showactive=True,
        )],
        paper_bgcolor=BG_MAIN,
        height=420,
    )
    return fig


def fig_monthly_weekday_drill(months_data: dict) -> go.Figure:
    """Weekday avg/peak bar drill-down per month (dropdown)."""
    sorted_months = sorted(months_data.keys())
    first_month   = sorted_months[0]
    WEEKDAYS      = ["Monday", "Tuesday", "Wednesday",
                     "Thursday", "Friday", "Saturday", "Sunday"]

    fig = go.Figure()
    buttons = []

    for mk in sorted_months:
        wdp     = months_data[mk]["day_of_week"]
        wd_map  = {w["weekday"]: w for w in wdp}
        avgs    = [wd_map.get(w, {}).get("avg", 0)  for w in WEEKDAYS]
        peaks   = [wd_map.get(w, {}).get("peak", 0) for w in WEEKDAYS]

        visible_avg  = mk == first_month
        visible_peak = mk == first_month

        fig.add_bar(x=WEEKDAYS, y=avgs,  name=f"{month_label(mk)} Avg",
                    marker_color=PRIMARY, visible=visible_avg,
                    text=avgs, textposition="outside")
        fig.add_bar(x=WEEKDAYS, y=peaks, name=f"{month_label(mk)} Peak",
                    marker_color=ACCENT,  visible=visible_peak,
                    text=peaks, textposition="outside")

    # Each month has 2 traces (avg + peak)
    n = len(sorted_months)
    buttons = []
    for i, mk in enumerate(sorted_months):
        vis = [False] * (n * 2)
        vis[i * 2]     = True
        vis[i * 2 + 1] = True
        buttons.append(dict(
            label=month_label(mk),
            method="update",
            args=[{"visible": vis},
                  {"title": f"Weekday Profile — {month_label(mk)}"}],
        ))

    fig.update_layout(
        title=f"Weekday Profile — {month_label(first_month)}",
        barmode="group",
        xaxis_title="Day of Week",
        yaxis_title="Patrons",
        updatemenus=[dict(
            buttons=buttons,
            direction="down",
            x=0.01, y=1.12, xanchor="left",
            showactive=True,
        )],
        legend=dict(orientation="h", y=1.02, x=1, xanchor="right"),
        plot_bgcolor=BG_CARD,
        paper_bgcolor=BG_MAIN,
    )
    return fig


def fig_monthly_hourly_drill(months_data: dict) -> go.Figure:
    """Hourly avg line drill-down per month (dropdown)."""
    sorted_months = sorted(months_data.keys())
    first_month   = sorted_months[0]
    HOURS         = [f"{h:02d}:00" for h in range(24)]

    fig = go.Figure()
    for mk in sorted_months:
        hp    = months_data[mk]["hourly_profile"]
        h_map = {h["label"]: h["avg"] for h in hp}
        avgs  = [h_map.get(lbl, 0) for lbl in HOURS]
        fig.add_scatter(
            x=HOURS, y=avgs, mode="lines+markers",
            name=month_label(mk),
            visible=(mk == first_month),
            line=dict(width=2.5),
            marker=dict(size=6),
        )

    n = len(sorted_months)
    buttons = []
    for i, mk in enumerate(sorted_months):
        vis = [False] * n
        vis[i] = True
        buttons.append(dict(
            label=month_label(mk),
            method="update",
            args=[{"visible": vis},
                  {"title": f"Hourly Profile (ET) — {month_label(mk)}"}],
        ))

    fig.update_layout(
        title=f"Hourly Profile (ET) — {month_label(first_month)}",
        xaxis_title="Hour ET",
        yaxis_title="Avg Patrons",
        updatemenus=[dict(
            buttons=buttons,
            direction="down",
            x=0.01, y=1.12, xanchor="left",
            showactive=True,
        )],
        plot_bgcolor=BG_CARD,
        paper_bgcolor=BG_MAIN,
    )
    return fig


def fig_floor_monthly_line(months_data: dict) -> go.Figure:
    """Per-floor avg across months — 4 lines on one chart."""
    sorted_months = sorted(months_data.keys())
    month_labels  = [month_label(mk) for mk in sorted_months]

    fig = go.Figure()
    for floor, color in FLOOR_COLORS.items():
        avgs = [
            next((f["avg"] for f in months_data[mk]["floor_breakdown"]
                  if f["floor"] == floor), 0)
            for mk in sorted_months
        ]
        fig.add_scatter(
            x=month_labels, y=avgs, mode="lines+markers",
            name=floor,
            line=dict(color=color, width=2.5),
            marker=dict(size=8),
            text=avgs, textposition="top center",
        )
    fig.update_layout(
        title="Per-Floor Patron Trend Across Months",
        xaxis_title="Month",
        yaxis_title="Avg Patrons",
        legend=dict(orientation="h", y=1.02, x=1, xanchor="right"),
        plot_bgcolor=BG_CARD,
        paper_bgcolor=BG_MAIN,
    )
    return fig


# ---------------------------------------------------------------------------
# Assemble and write HTML
# ---------------------------------------------------------------------------

SECTION_STYLE = (
    "font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;"
    "max-width:1280px;margin:0 auto;padding:10px 20px;"
)

DIV_STYLE = (
    "background:#fff;border:1px solid #dee2e6;border-radius:8px;"
    "padding:16px;margin-bottom:28px;"
    "box-shadow:0 2px 8px rgba(0,0,0,.08);"
)

H2_STYLE = (
    "color:#0066cc;font-size:1.1em;margin:0 0 12px;"
    "border-bottom:2px solid #0066cc;padding-bottom:6px;"
)


def card_html(title: str, value: str, sub: str = "", color: str = PRIMARY) -> str:
    return f"""
    <div style="background:linear-gradient(135deg,{color},{color}cc);
                color:#fff;padding:20px;border-radius:10px;text-align:center;
                flex:1;min-width:200px;">
      <div style="font-size:.9em;opacity:.85;margin-bottom:6px;">{title}</div>
      <div style="font-size:2em;font-weight:700;line-height:1.1;">{value}</div>
      <div style="font-size:.76em;opacity:.75;margin-top:5px;">{sub}</div>
    </div>"""


def build_dashboard(doc: dict, output_path: str) -> None:
    g  = doc["global"]
    ms = doc["months"]
    s  = g["overall_stats"]

    # --- Build all figures ---
    figs = {
        "monthly_bars":        fig_monthly_bars(g),
        "top_bottom_days":     fig_top_bottom_days(g),
        "weekday_heatmap":     fig_weekday_heatmap(ms, g),
        "hourly_heatmap":      fig_hourly_heatmap(ms),
        "hourly_line":         fig_hourly_line(g),
        "weekday_bar_global":  fig_weekday_bar_global(g),
        "floor_bars":          fig_floor_bars_fixed(ms),
        "floor_line":          fig_floor_monthly_line(ms),
        "floor_radar":         fig_floor_peak_hours_radar(g),
        "daily_timeline":      fig_daily_timeline_all(ms),
        "top10_table":         fig_monthly_top10_table(ms),
        "bottom10_table":      fig_monthly_bottom10_table(ms),
        "weekday_drill":       fig_monthly_weekday_drill(ms),
        "hourly_drill":        fig_monthly_hourly_drill(ms),
    }

    cfg = {"displayModeBar": True, "responsive": True,
           "modeBarButtonsToRemove": ["lasso2d", "select2d"]}

    def fig_html(key: str) -> str:
        return pio.to_html(figs[key], full_html=False,
                           include_plotlyjs=False, config=cfg)

    # --- Overview cards ---
    peak_r = s["peak_record"]
    quiet_r = s["quiet_record"]
    months_list = ", ".join(
        [f"{m[:4]}" for m in s["months_covered"][:1]]
        + ["..."]
        + [f"{m[:4]}" for m in s["months_covered"][-1:]]
    ) if len(s["months_covered"]) > 2 else ", ".join(s["months_covered"])

    cards = f"""
    <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:28px;">
      {card_html("Total 15-min Readings", f"{s['total_records']:,}",
                 f"{len(s['months_covered'])} months · Oct 2025 – May 2026", "#005fa3")}
      {card_html("All-Time Avg Patrons", str(s['all_time_avg']),
                 "per 15-min interval", "#0077cc")}
      {card_html("All-Time Peak", str(s['all_time_peak']),
                 f"{peak_r['timestamp_et']} · {peak_r['weekday']}", "#c0392b")}
      {card_html("Quietest Reading", str(s['all_time_low']),
                 f"{quiet_r['timestamp_et']} · {quiet_r['weekday']}", "#6c757d")}
    </div>"""

    # --- Insight callouts ---
    best_month  = max(g["monthly_overview"], key=lambda m: m["avg_patrons"])
    worst_month = min(g["monthly_overview"], key=lambda m: m["avg_patrons"])
    best_wd     = max(g["day_of_week_profile"], key=lambda w: w["avg"])
    worst_wd    = min(g["day_of_week_profile"], key=lambda w: w["avg"])
    peak_hour   = max(g["hourly_profile"], key=lambda h: h["avg"])
    busiest_fl  = max(g["floor_breakdown"],  key=lambda f: f["avg"])

    insights = f"""
    <div style="{DIV_STYLE}">
      <h2 style="{H2_STYLE}">Key Insights</h2>
      <div style="display:flex;flex-wrap:wrap;gap:12px;font-size:.92em;">
        <div style="flex:1;min-width:220px;padding:10px;background:#e9f2ff;border-radius:6px;">
          📈 <strong>Busiest Month:</strong> {best_month['month']} —
          avg {best_month['avg_patrons']} patrons/interval,
          peak {best_month['peak_patrons']}
        </div>
        <div style="flex:1;min-width:220px;padding:10px;background:#ffeaea;border-radius:6px;">
          📉 <strong>Quietest Month:</strong> {worst_month['month']} —
          avg {worst_month['avg_patrons']} patrons/interval
        </div>
        <div style="flex:1;min-width:220px;padding:10px;background:#e9f2ff;border-radius:6px;">
          📅 <strong>Busiest Weekday:</strong> {best_wd['weekday']} —
          avg {best_wd['avg']}, peak {best_wd['peak']}
        </div>
        <div style="flex:1;min-width:220px;padding:10px;background:#ffeaea;border-radius:6px;">
          📅 <strong>Quietest Weekday:</strong> {worst_wd['weekday']} —
          avg {worst_wd['avg']}
        </div>
        <div style="flex:1;min-width:220px;padding:10px;background:#e9f2ff;border-radius:6px;">
          🕐 <strong>Peak Hour (ET):</strong> {peak_hour['label']} —
          avg {peak_hour['avg']} patrons
        </div>
        <div style="flex:1;min-width:220px;padding:10px;background:#e9f2ff;border-radius:6px;">
          🏢 <strong>Busiest Floor:</strong> {busiest_fl['floor']} —
          avg {busiest_fl['avg']}, peak {busiest_fl['peak']}
        </div>
      </div>
    </div>"""

    # --- Full HTML document ---
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>King Library Patron Analytics Dashboard</title>
  <script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script>
  <style>
    *,*::before,*::after{{box-sizing:border-box}}
    body{{margin:0;background:#f0f2f5;
         font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif}}
    h1{{color:#0066cc;margin:0;font-size:1.8em}}
    .header{{background:#fff;padding:22px 32px;
             border-bottom:3px solid #0066cc;
             box-shadow:0 2px 6px rgba(0,0,0,.1)}}
    .header p{{margin:6px 0 0;color:#6c757d;font-size:.9em}}
    .main{{max-width:1280px;margin:0 auto;padding:24px 20px}}
    .chart-card{{background:#fff;border:1px solid #dee2e6;border-radius:8px;
                 padding:16px;margin-bottom:28px;
                 box-shadow:0 2px 8px rgba(0,0,0,.08)}}
    .chart-card h2{{color:#0066cc;font-size:1.05em;margin:0 0 10px;
                    border-bottom:2px solid #0066cc;padding-bottom:6px}}
    .grid-2{{display:grid;grid-template-columns:1fr 1fr;gap:20px}}
    @media(max-width:800px){{.grid-2{{grid-template-columns:1fr}}}}
    .section-label{{font-size:.75em;text-transform:uppercase;letter-spacing:.06em;
                    color:#6c757d;margin:32px 0 6px;font-weight:600}}
  </style>
</head>
<body>
<div class="header">
  <h1>King Library · Patron Analytics Dashboard</h1>
  <p>Generated: {doc['generated_at']} &nbsp;·&nbsp;
     Covers: {" → ".join([s["months_covered"][0], s["months_covered"][-1]])} &nbsp;·&nbsp;
     All timestamps in Eastern Time (UTC{doc['et_offset_hours']:+d}h)</p>
</div>
<div class="main">

  <!-- Overview cards -->
  <div class="section-label">Overview</div>
  {cards}

  <!-- Key insights -->
  {insights}

  <!-- Monthly comparison -->
  <div class="section-label">Monthly Trends</div>
  <div class="chart-card">
    <h2>Monthly Average vs Peak Patrons</h2>
    {fig_html("monthly_bars")}
  </div>

  <!-- Daily timeline -->
  <div class="chart-card">
    <h2>Daily Average Patron Count — All Months</h2>
    {fig_html("daily_timeline")}
  </div>

  <!-- Top/bottom cross-month days -->
  <div class="section-label">Best & Worst Days</div>
  <div class="chart-card">
    <h2>All-Time Top-10 &amp; Bottom-10 Days (by daily average)</h2>
    {fig_html("top_bottom_days")}
  </div>

  <!-- Per-month drill: top-10 & bottom-10 tables -->
  <div class="grid-2">
    <div class="chart-card">
      <h2>Top-10 Busiest Days — by Month</h2>
      {fig_html("top10_table")}
    </div>
    <div class="chart-card">
      <h2>Bottom-10 Quietest Days — by Month</h2>
      {fig_html("bottom10_table")}
    </div>
  </div>

  <!-- Weekday & hourly global -->
  <div class="section-label">Patterns by Day &amp; Hour</div>
  <div class="grid-2">
    <div class="chart-card">
      <h2>Day-of-Week Profile (All Months)</h2>
      {fig_html("weekday_bar_global")}
    </div>
    <div class="chart-card">
      <h2>Hourly Profile — Avg &amp; Peak (All Months, ET)</h2>
      {fig_html("hourly_line")}
    </div>
  </div>

  <!-- Heatmaps -->
  <div class="chart-card">
    <h2>Heatmap: Average Patrons by Day-of-Week × Month</h2>
    {fig_html("weekday_heatmap")}
  </div>
  <div class="chart-card">
    <h2>Heatmap: Average Patrons by Hour (ET) × Month</h2>
    {fig_html("hourly_heatmap")}
  </div>

  <!-- Drill-down by month -->
  <div class="section-label">Month Drill-Down</div>
  <div class="grid-2">
    <div class="chart-card">
      <h2>Weekday Profile — Select a Month</h2>
      {fig_html("weekday_drill")}
    </div>
    <div class="chart-card">
      <h2>Hourly Profile (ET) — Select a Month</h2>
      {fig_html("hourly_drill")}
    </div>
  </div>

  <!-- Floor analysis -->
  <div class="section-label">Floor Analysis</div>
  <div class="chart-card">
    <h2>Average Patrons per Floor × Month</h2>
    {fig_html("floor_bars")}
  </div>
  <div class="grid-2">
    <div class="chart-card">
      <h2>Per-Floor Patron Trend Across Months</h2>
      {fig_html("floor_line")}
    </div>
    <div class="chart-card">
      <h2>Floor Peak Hours — Top-5 ET Hours (Radar)</h2>
      {fig_html("floor_radar")}
    </div>
  </div>

  <div style="text-align:center;color:#6c757d;font-size:.8em;padding:24px 0;">
    Generated by visualize_summary.py &nbsp;·&nbsp;
    Data: King Library Cisco CMX WiFi Analytics
  </div>
</div>
</body>
</html>"""

    with open(output_path, "w", encoding="utf-8") as fh:
        fh.write(html)

    print(f"\n[visualize_summary] Dashboard written → {os.path.abspath(output_path)}")
    print(f"  Open it in your browser:  open \"{os.path.abspath(output_path)}\"")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate an interactive HTML analytics dashboard from big_summary.json"
    )
    parser.add_argument(
        "--analysis-file",
        default=os.path.join(os.path.dirname(__file__), "..", "stored_data",
                             "analysis", "big_summary.json"),
        help="Path to big_summary.json (default: stored_data/analysis/big_summary.json)",
    )
    parser.add_argument(
        "--output-file",
        default=os.path.join(os.path.dirname(__file__), "..", "stored_data",
                             "analysis", "dashboard.html"),
        help="Where to write dashboard.html (default: stored_data/analysis/dashboard.html)",
    )
    args = parser.parse_args()

    analysis_path = os.path.abspath(args.analysis_file)
    output_path   = os.path.abspath(args.output_file)

    if not os.path.exists(analysis_path):
        print(f"ERROR: {analysis_path!r} not found.")
        print("  Run  python3 scripts/big_summary.py  first.")
        sys.exit(1)

    print(f"[visualize_summary] Loading {analysis_path!r} ...")
    doc = load(analysis_path)
    print(f"[visualize_summary] Building dashboard ({len(doc['months'])} months) ...")
    build_dashboard(doc, output_path)


if __name__ == "__main__":
    main()
