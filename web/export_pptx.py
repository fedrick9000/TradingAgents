"""PPT generation for trading analysis reports.

Generates a 9-slide PPTX deck from a dict of markdown report sections.
Slide order: Cover, Executive Summary, Fundamentals, News,
             Sentiment, Technical, Research Debate, Risk, Final Decision.
"""
import io
import re

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.util import Inches, Pt

# ── palette ───────────────────────────────────────────────────────────────
_BG    = RGBColor(0x0F, 0x17, 0x2A)
_WHITE = RGBColor(0xFF, 0xFF, 0xFF)
_MUTED = RGBColor(0x94, 0xA3, 0xB8)
_BUY   = RGBColor(0x10, 0xB9, 0x81)
_SELL  = RGBColor(0xEF, 0x44, 0x44)
_HOLD  = RGBColor(0xF5, 0x9E, 0x0B)

_SLIDE_W = Inches(13.333)
_SLIDE_H = Inches(7.5)


def _signal_color(signal: str) -> RGBColor:
    s = signal.upper()
    if s in ("BUY", "OVERWEIGHT"):  return _BUY
    if s in ("SELL", "UNDERWEIGHT"): return _SELL
    return _HOLD


def _hex_signal(signal: str) -> str:
    s = signal.upper()
    if s in ("BUY", "OVERWEIGHT"):   return "#10B981"
    if s in ("SELL", "UNDERWEIGHT"): return "#EF4444"
    return "#F59E0B"


def _set_bg(slide):
    fill = slide.background.fill
    fill.solid()
    fill.fore_color.rgb = _BG


def _add_text(slide, text, left, top, width, height,
              size=18, bold=False, color=None, align=PP_ALIGN.LEFT, wrap=True):
    txb = slide.shapes.add_textbox(left, top, width, height)
    txb.word_wrap = wrap
    tf = txb.text_frame
    tf.word_wrap = wrap
    p = tf.paragraphs[0]
    p.alignment = align
    run = p.add_run()
    run.text = text
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = color or _WHITE


def _extract_bullets(text: str, max_bullets: int = 5) -> list[str]:
    """Return up to max_bullets plain bullet strings from markdown text."""
    bullets = []
    for raw in text.split('\n'):
        line = raw.strip()
        if not line:
            continue
        if line.startswith('#'):
            continue
        # strip markdown bold/italic
        line = re.sub(r'\*{1,3}([^*]+)\*{1,3}', r'\1', line)
        line = re.sub(r'`([^`]+)`', r'\1', line)
        if line.startswith(('- ', '* ', '• ')):
            bullets.append(line[2:].strip())
        elif len(bullets) == 0 and len(line) > 25:
            # Use first substantive sentence if no bullets
            sentences = re.split(r'(?<=[.!?])\s+', line)
            bullets.extend(s for s in sentences[:2] if len(s) > 10)
        if len(bullets) >= max_bullets:
            break
    return bullets[:max_bullets]


def _add_bullets(slide, items: list[str], left, top, width, height,
                 size=14, color=None):
    txb = slide.shapes.add_textbox(left, top, width, height)
    txb.word_wrap = True
    tf = txb.text_frame
    tf.word_wrap = True
    for i, item in enumerate(items):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = PP_ALIGN.LEFT
        run = p.add_run()
        run.text = f"• {item}"
        run.font.size = Pt(size)
        run.font.color.rgb = color or _WHITE


def _extract_score(text: str, pattern: str = r'(\d+(?:\.\d+)?)\s*/\s*10') -> float | None:
    m = re.search(pattern, text)
    return float(m.group(1)) if m else None


def _extract_kv_table(text: str) -> list[tuple[str, str]]:
    """Extract 'Key: Value' pairs from text for fundamentals table."""
    rows = []
    for line in text.split('\n'):
        line = line.strip()
        if not line:
            continue
        # match "P/E: 28x" or "P/E Ratio  28x"
        m = re.match(r'^([A-Za-z/\s]+?)\s*[:\t]\s*(.+)$', line)
        if m:
            key = m.group(1).strip()[:30]
            val = re.sub(r'\*{1,3}([^*]+)\*{1,3}', r'\1', m.group(2).strip())[:40]
            rows.append((key, val))
        if len(rows) >= 8:
            break
    return rows


def _make_sentiment_gauge(score: float) -> bytes:
    """Return PNG bytes of a half-circle gauge for score 0–10."""
    fig, ax = plt.subplots(figsize=(4, 2.2), facecolor='#0F172A')
    ax.set_facecolor('#0F172A')
    ax.set_xlim(-1.3, 1.3)
    ax.set_ylim(-0.3, 1.3)
    ax.set_aspect('equal')
    ax.axis('off')

    # background arc
    theta = np.linspace(np.pi, 0, 200)
    ax.plot(np.cos(theta), np.sin(theta), color='#1E293B', linewidth=12)

    # colored arc up to score
    frac = max(0, min(score / 10, 1))
    theta_fill = np.linspace(np.pi, np.pi - frac * np.pi, 200)
    color = '#EF4444' if score < 4 else ('#F59E0B' if score < 7 else '#10B981')
    ax.plot(np.cos(theta_fill), np.sin(theta_fill), color=color, linewidth=12)

    # needle
    angle = np.pi - frac * np.pi
    ax.annotate('', xy=(0.75 * np.cos(angle), 0.75 * np.sin(angle)),
                xytext=(0, 0),
                arrowprops=dict(arrowstyle='->', color='white', lw=2))

    ax.text(0, -0.2, f'{score:.1f} / 10', ha='center', va='center',
            fontsize=14, color='white', fontweight='bold')

    buf = io.BytesIO()
    fig.savefig(buf, format='png', bbox_inches='tight', dpi=120,
                facecolor='#0F172A')
    plt.close(fig)
    return buf.getvalue()


def _make_risk_bar(text: str) -> bytes:
    """Return PNG bytes of a risk level bar extracted from report text."""
    t = text.lower()
    if 'high risk' in t or 'elevated risk' in t:
        level, val, color = 'HIGH', 3, '#EF4444'
    elif 'medium risk' in t or 'moderate risk' in t:
        level, val, color = 'MEDIUM', 2, '#F59E0B'
    else:
        level, val, color = 'LOW', 1, '#10B981'

    fig, ax = plt.subplots(figsize=(5, 1.4), facecolor='#0F172A')
    ax.set_facecolor('#0F172A')
    ax.axis('off')

    labels = ['LOW', 'MEDIUM', 'HIGH']
    colors = ['#10B981', '#F59E0B', '#EF4444']
    for i, (lbl, c) in enumerate(zip(labels, colors)):
        alpha = 1.0 if lbl == level else 0.25
        ax.barh(0, 1, left=i * 1.2, height=0.6,
                color=c, alpha=alpha)
        ax.text(i * 1.2 + 0.5, 0, lbl, ha='center', va='center',
                color='white', fontsize=11, fontweight='bold')

    buf = io.BytesIO()
    fig.savefig(buf, format='png', bbox_inches='tight', dpi=120,
                facecolor='#0F172A')
    plt.close(fig)
    return buf.getvalue()


def _make_price_bar(text: str) -> bytes:
    """Extract current price vs MAs from text and produce a bar chart."""
    patterns = {
        'Close': r'close[^:\n]{0,10}[:=]\s*\$?([\d,.]+)',
        '10 EMA': r'10\s*ema[^:\n]{0,10}[:=]\s*\$?([\d,.]+)',
        '50 SMA': r'50\s*sma[^:\n]{0,10}[:=]\s*\$?([\d,.]+)',
        '200 SMA': r'200\s*sma[^:\n]{0,10}[:=]\s*\$?([\d,.]+)',
    }
    vals = {}
    for label, pat in patterns.items():
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            try:
                vals[label] = float(m.group(1).replace(',', ''))
            except ValueError:
                pass

    if not vals:
        return None

    fig, ax = plt.subplots(figsize=(5, 2.8), facecolor='#0F172A')
    ax.set_facecolor('#1E293B')
    labels = list(vals.keys())
    values = list(vals.values())
    close = vals.get('Close', values[0])
    bar_colors = ['#3B82F6' if v <= close else '#94A3B8' for v in values]
    if 'Close' in vals:
        bar_colors[labels.index('Close')] = '#10B981'

    ax.barh(labels, values, color=bar_colors)
    for i, v in enumerate(values):
        ax.text(v, i, f' {v:,.2f}', va='center', color='white', fontsize=9)
    ax.set_xlabel('Price', color='#94A3B8', fontsize=9)
    ax.tick_params(colors='#94A3B8')
    ax.spines[:].set_color('#1E293B')
    for spine in ax.spines.values():
        spine.set_visible(False)
    ax.xaxis.set_tick_params(labelcolor='#94A3B8')
    ax.yaxis.set_tick_params(labelcolor='white')

    buf = io.BytesIO()
    fig.savefig(buf, format='png', bbox_inches='tight', dpi=120,
                facecolor='#0F172A')
    plt.close(fig)
    return buf.getvalue()


def _add_chart_image(slide, png_bytes: bytes, left, top, width, height):
    if not png_bytes:
        return
    img_stream = io.BytesIO(png_bytes)
    slide.shapes.add_picture(img_stream, left, top, width, height)


# ── slide builders ────────────────────────────────────────────────────────

def _slide_cover(prs, data):
    slide = prs.slides.add_slide(prs.slide_layouts[6])  # blank
    _set_bg(slide)
    sig    = data['signal']
    col    = _signal_color(sig)
    ticker = data['ticker']
    date   = data.get('date', '')

    # Large signal badge (rectangle)
    left, top = Inches(1), Inches(1.8)
    shp = slide.shapes.add_shape(1, left, top, Inches(3), Inches(1.1))
    shp.fill.solid()
    shp.fill.fore_color.rgb = col
    shp.line.color.rgb = col
    tf = shp.text_frame
    tf.paragraphs[0].alignment = PP_ALIGN.CENTER
    run = tf.paragraphs[0].add_run()
    run.text = sig
    run.font.size = Pt(36)
    run.font.bold = True
    run.font.color.rgb = _WHITE

    _add_text(slide, ticker, Inches(1), Inches(3.3), Inches(6), Inches(1),
              size=40, bold=True)
    company = _extract_company_name(ticker, data.get('reports', {}).get('market_report', ''))
    if company != ticker:
        _add_text(slide, company, Inches(1), Inches(4.1), Inches(8), Inches(0.7),
                  size=20, color=_MUTED)
    _add_text(slide, f"Analysis Date: {date}", Inches(1), Inches(4.8),
              Inches(6), Inches(0.5), size=14, color=_MUTED)
    _add_text(slide, "AI-Powered Multi-Agent Stock Analysis",
              Inches(1), Inches(6.4), Inches(8), Inches(0.6), size=12, color=_MUTED)


def _slide_exec_summary(prs, data):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    _set_bg(slide)
    _add_text(slide, "Executive Summary", Inches(0.5), Inches(0.3),
              Inches(8), Inches(0.7), size=24, bold=True)

    market = data.get('reports', {}).get('market_report', '')
    bullets = _extract_bullets(market, max_bullets=5)
    _add_bullets(slide, bullets, Inches(0.5), Inches(1.2), Inches(7), Inches(5))

    png = _make_price_bar(market)
    if png:
        _add_chart_image(slide, png, Inches(8), Inches(1.2), Inches(4.8), Inches(3))


def _slide_fundamentals(prs, data):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    _set_bg(slide)
    _add_text(slide, "Fundamentals", Inches(0.5), Inches(0.3),
              Inches(8), Inches(0.7), size=24, bold=True)

    text = data.get('reports', {}).get('fundamentals_report', '')
    rows = _extract_kv_table(text)

    if rows:
        tbl = slide.shapes.add_table(len(rows) + 1, 2,
                                      Inches(0.5), Inches(1.2),
                                      Inches(5), Inches(min(len(rows) * 0.45 + 0.5, 5.5))).table
        for ci, header in enumerate(('Metric', 'Value')):
            cell = tbl.cell(0, ci)
            cell.text = header
            cell.text_frame.paragraphs[0].runs[0].font.bold = True
            cell.text_frame.paragraphs[0].runs[0].font.size = Pt(11)
            cell.fill.solid()
            cell.fill.fore_color.rgb = RGBColor(0x1E, 0x29, 0x3B)
        for ri, (k, v) in enumerate(rows):
            for ci, val in enumerate((k, v)):
                cell = tbl.cell(ri + 1, ci)
                cell.text = val
                cell.text_frame.paragraphs[0].runs[0].font.size = Pt(10)
                cell.text_frame.paragraphs[0].runs[0].font.color.rgb = _WHITE
                cell.fill.solid()
                cell.fill.fore_color.rgb = RGBColor(0x0F, 0x17, 0x2A) if ri % 2 == 0 \
                                           else RGBColor(0x1A, 0x23, 0x3A)
    else:
        bullets = _extract_bullets(text, max_bullets=7)
        _add_bullets(slide, bullets, Inches(0.5), Inches(1.2), Inches(12), Inches(5.5))


def _slide_news(prs, data):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    _set_bg(slide)
    _add_text(slide, "News Analysis", Inches(0.5), Inches(0.3),
              Inches(8), Inches(0.7), size=24, bold=True)
    text = data.get('reports', {}).get('news_report', '')
    bullets = _extract_bullets(text, max_bullets=6)
    _add_bullets(slide, bullets, Inches(0.5), Inches(1.2), Inches(12), Inches(5.5))


def _slide_sentiment(prs, data):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    _set_bg(slide)
    _add_text(slide, "Sentiment Analysis", Inches(0.5), Inches(0.3),
              Inches(8), Inches(0.7), size=24, bold=True)
    text = data.get('reports', {}).get('sentiment_report', '')
    bullets = _extract_bullets(text, max_bullets=5)
    _add_bullets(slide, bullets, Inches(0.5), Inches(1.2), Inches(7.5), Inches(4))

    score = _extract_score(text)
    if score is not None:
        png = _make_sentiment_gauge(score)
        _add_chart_image(slide, png, Inches(8.5), Inches(1.5), Inches(4.3), Inches(2.5))


def _slide_technical(prs, data):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    _set_bg(slide)
    _add_text(slide, "Technical Analysis", Inches(0.5), Inches(0.3),
              Inches(8), Inches(0.7), size=24, bold=True)
    text = data.get('reports', {}).get('market_report', '')
    bullets = _extract_bullets(text, max_bullets=5)
    _add_bullets(slide, bullets, Inches(0.5), Inches(1.2), Inches(7.5), Inches(4))

    png = _make_price_bar(text)
    if png:
        _add_chart_image(slide, png, Inches(8), Inches(1.2), Inches(4.8), Inches(3))


def _slide_research_debate(prs, data):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    _set_bg(slide)
    _add_text(slide, "Research Debate", Inches(0.5), Inches(0.3),
              Inches(12), Inches(0.7), size=24, bold=True)

    invest = data.get('debate', {}).get('investment', {})
    # Bull column
    _add_text(slide, "Bull Case", Inches(0.5), Inches(1.1),
              Inches(5.5), Inches(0.5), size=14, bold=True, color=_BUY)
    bull_text = invest.get('Bull Researcher', '')
    _add_bullets(slide, _extract_bullets(bull_text, 4),
                 Inches(0.5), Inches(1.7), Inches(5.5), Inches(4.5), size=12)

    # Bear column
    _add_text(slide, "Bear Case", Inches(7), Inches(1.1),
              Inches(5.5), Inches(0.5), size=14, bold=True, color=_SELL)
    bear_text = invest.get('Bear Researcher', '')
    _add_bullets(slide, _extract_bullets(bear_text, 4),
                 Inches(7), Inches(1.7), Inches(5.5), Inches(4.5), size=12)

    # Divider line
    slide.shapes.add_connector(1, Inches(6.4), Inches(1.1), Inches(6.4), Inches(6.5))

    # Judgment
    judge = invest.get('Research Manager', '')
    if judge:
        judge_bullets = _extract_bullets(judge, 1)
        judge_line = "Research Manager: " + judge_bullets[0] if judge_bullets else ''
        if judge_line:
            _add_text(slide, judge_line,
                      Inches(0.5), Inches(6.2), Inches(12), Inches(0.8), size=12, color=_MUTED)


def _slide_risk(prs, data):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    _set_bg(slide)
    _add_text(slide, "Risk Assessment", Inches(0.5), Inches(0.3),
              Inches(8), Inches(0.7), size=24, bold=True)

    risk = data.get('debate', {}).get('risk', {})
    pm_text = risk.get('Portfolio Manager', '')
    bullets = _extract_bullets(pm_text or data.get('decision_text', ''), max_bullets=5)
    _add_bullets(slide, bullets, Inches(0.5), Inches(1.2), Inches(7.5), Inches(4))

    decision_text = data.get('decision_text', '')
    png = _make_risk_bar(decision_text + ' ' + pm_text)
    if png:
        _add_chart_image(slide, png, Inches(8), Inches(1.5), Inches(4.8), Inches(1.8))


def _slide_final(prs, data):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    _set_bg(slide)
    sig = data['signal']
    col = _signal_color(sig)

    # Large signal
    shp = slide.shapes.add_shape(1, Inches(4.5), Inches(0.5), Inches(4.3), Inches(1.4))
    shp.fill.solid()
    shp.fill.fore_color.rgb = col
    shp.line.color.rgb = col
    tf = shp.text_frame
    tf.paragraphs[0].alignment = PP_ALIGN.CENTER
    run = tf.paragraphs[0].add_run()
    run.text = sig
    run.font.size = Pt(44)
    run.font.bold = True
    run.font.color.rgb = _WHITE

    _add_text(slide, f"Final Decision: {data['ticker']}", Inches(0.5), Inches(2.1),
              Inches(12), Inches(0.7), size=20, bold=True)

    dec_text = data.get('decision_text', '')
    bullets = _extract_bullets(dec_text, max_bullets=5)
    _add_bullets(slide, bullets, Inches(0.5), Inches(3.0), Inches(12), Inches(3.2), size=14)

    _add_text(slide, "This report is for informational purposes only and does not constitute investment advice.",
              Inches(0.5), Inches(6.9), Inches(12), Inches(0.5),
              size=9, color=_MUTED)


def _extract_company_name(ticker: str, market_report: str) -> str:
    if not market_report:
        return ticker
    escaped = re.escape(ticker)
    m = re.search(rf'{escaped}\s*\(([^)]+)\)', market_report)
    return m.group(1).strip() if m else ticker


# ── public API ────────────────────────────────────────────────────────────

def generate_pptx(data: dict) -> bytes:
    """Build a 9-slide PPTX and return the raw bytes.

    Slide order: Cover, Executive Summary, Fundamentals, News,
                 Sentiment, Technical, Research Debate, Risk, Final Decision.
    """
    prs = Presentation()
    prs.slide_width  = _SLIDE_W
    prs.slide_height = _SLIDE_H

    _slide_cover(prs, data)
    _slide_exec_summary(prs, data)
    _slide_fundamentals(prs, data)
    _slide_news(prs, data)
    _slide_sentiment(prs, data)
    _slide_technical(prs, data)
    _slide_research_debate(prs, data)
    _slide_risk(prs, data)
    _slide_final(prs, data)

    buf = io.BytesIO()
    prs.save(buf)
    return buf.getvalue()
