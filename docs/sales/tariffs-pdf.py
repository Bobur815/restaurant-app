# SavdoChef tariff sheet (A4, Uzbek) for printing. Needs: pip install reportlab.
# Usage: python docs/sales/tariffs-pdf.py C:/Users/user/Desktop/SavdoChef-tariflar.pdf
# Prices: PRICE / EXTRA_PHONE below; keep them equal to the posgro dashboard (SavdoChef settings).
import sys
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether, PageBreak

pdfmetrics.registerFont(TTFont("Arial", "C:/Windows/Fonts/arial.ttf"))
pdfmetrics.registerFont(TTFont("Arial-Bold", "C:/Windows/Fonts/arialbd.ttf"))
pdfmetrics.registerFont(TTFont("Sym", "C:/Windows/Fonts/seguisym.ttf"))
pdfmetrics.registerFontFamily("Arial", normal="Arial", bold="Arial-Bold")

OUT = sys.argv[1]

# Monthly prices (so'm) as on the posgro dashboard, SavdoChef settings.
PRICE = {"Start": "100 000", "Standard": "150 000", "Pro": "250 000"}
EXTRA_PHONE = "50 000"
# VIP (paid once, never expires) = 1 000 000 + 18 x the monthly price (2026-11-23).
VIP = {"Start": "2 800 000", "Standard": "3 700 000", "Pro": "5 500 000"}
# Fiscalisation through REGOS:VCR (the only fiscal module SavdoChef supports, F18), so'm.
# All three as in the Alipos sheet (owner's decision, 2026-11-23).
FISCAL = [("Davlat boji", 440_000), ("Ustanovka", 1_200_000), ("3 oylik to'lov oldindan (REGOS)", 225_000)]

def som(n):
    return f"{n:,}".replace(",", " ")

# Setup service for monthly plans (so'm); VIP prices already include the main setup.
SETUP = [
    ("Asosiy kassa o'rnatish", "Dastur, 1 ta chek printeri, menyuni kiritish (100 taomgacha), 1 soat o'rgatish", "500 000"),
    ("Qo'shimcha kassa (yo'ldosh kassa)", "Kompyuter yoki noutbukni asosiy kassaga ulash, har biri", "150 000"),
    ("Qo'shimcha printer", "Oshxona yoki bar printeri, har biri", "70 000"),
    ("Qo'shimcha o'rgatish", "Xodimlar uchun, har 1 soat", "80 000"),
    ("Kabel tortish", "1 metr + montaj", "7 000"),
]
INK = colors.HexColor("#1f2937")
MUTED = colors.HexColor("#6b7280")
ACCENT = colors.HexColor("#ea580c")
LINE = colors.HexColor("#e5e7eb")
SOFT = colors.HexColor("#fff7ed")
SOON = colors.HexColor("#7c3aed")

def st(name, **kw):
    base = dict(fontName="Arial", fontSize=10, leading=14, textColor=INK)
    base.update(kw)
    return ParagraphStyle(name, **base)

H1 = st("h1", fontName="Arial-Bold", fontSize=24, leading=30)
SUB = st("sub", fontSize=11, leading=16, textColor=MUTED)
H2 = st("h2", fontName="Arial-Bold", fontSize=14, leading=18, spaceBefore=6, spaceAfter=4)
BODY = st("body")
NOTE = st("note", fontSize=9, leading=12)
SMALL = st("small", fontSize=8.5, leading=12, textColor=MUTED)
CELL = st("cell", fontSize=9, leading=11.5)
CELLB = st("cellb", fontName="Arial-Bold", fontSize=9, leading=12)
HEAD = st("head", fontName="Arial-Bold", fontSize=10, leading=13, alignment=TA_CENTER, textColor=colors.white)
CTR = st("ctr", fontSize=9, leading=12, alignment=TA_CENTER)
CARD_T = st("cardt", fontName="Arial-Bold", fontSize=15, leading=19, alignment=TA_CENTER)
CARD_P = st("cardp", fontName="Arial-Bold", fontSize=12.5, leading=16, alignment=TA_CENTER, textColor=ACCENT)
CARD_N = st("cardn", fontSize=8.5, leading=11.5, alignment=TA_CENTER, textColor=MUTED)

YES = '<font name="Sym" color="#16a34a" size="11">✓</font>'
NO = '<font color="#9ca3af">—</font>'
SOONTAG = '<font color="#7c3aed"><b>tez orada</b></font>'
NEW = ' <font color="#16a34a" size="7.5"><b>YANGI</b></font>'
def num(n):
    return f'<b>{n}</b>'

story = []
story.append(Paragraph('Savdo<font color="#ea580c">Chef</font>', H1))
story.append(Paragraph("Tariflar va imkoniyatlar", SUB))
story.append(Spacer(1, 2 * mm))
story.append(Paragraph(
    "SavdoChef: kafe va oshxonalar uchun oflayn kassa dasturi. Internetsiz ishlaydi, "
    "barcha ma'lumotlar kassa kompyuterida saqlanadi. Interfeys o'zbek va rus tillarida.", BODY))
story.append(Spacer(1, 2 * mm))

# Plan cards
cards = [
    ("Start", f"{PRICE['Start']} so'm", "oyiga", "Kichik kafe uchun kassa: olib ketish va yetkazib berish bilan"),
    ("Standard", f"{PRICE['Standard']} so'm", "oyiga", "Nasiya, to'liq hisobotlar va ofitsiant ilovasi (5 telefon)"),
    ("Pro", f"{PRICE['Pro']} so'm", "oyiga", "Bir nechta zal; tez orada ombor, retsept va Telegram bot"),
]
VIPLINE = st("vipline", fontName="Arial-Bold", fontSize=9, leading=12, alignment=TA_CENTER, textColor=INK)
vip_lines = [f"VIP: {VIP[n]} so'm<br/><font name=\"Arial\" color=\"#6b7280\" size=\"8\">bir marta to'lov, muddatsiz</font>" for n in ("Start", "Standard", "Pro")]
cw = (A4[0] - 30 * mm) / 3
cells = [[
    [Paragraph(t, CARD_T), Spacer(1, 2), Paragraph(p, CARD_P), Paragraph(per, CARD_N),
     Spacer(1, 4), Paragraph(d, CARD_N), Spacer(1, 4), Paragraph(v, VIPLINE)]
    for (t, p, per, d), v in zip(cards, vip_lines)
]]
ct = Table(cells, colWidths=[cw] * 3)
ct.setStyle(TableStyle([
    ("BOX", (0, 0), (0, 0), 0.8, LINE), ("BOX", (1, 0), (1, 0), 1.6, ACCENT),
    ("BOX", (2, 0), (2, 0), 0.8, LINE),
    ("BACKGROUND", (1, 0), (1, 0), SOFT),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5),
]))
story.append(ct)

# Comparison table
story.append(Paragraph("Imkoniyatlarni solishtirish", H2))
rows = [
    ("section", "Asosiy kassa (barcha tariflarda)"),
    ("Stollar va buyurtmalar (bitta zal)", YES, YES, YES),
    ("Olib ketish va yetkazib berish buyurtmalari", YES, YES, YES),
    ("To'lov: naqd, karta, Click", YES, YES, YES),
    ("Xizmat haqi: foizda yoki har bir mehmon uchun", YES, YES, YES),
    ("Smenalar: taomlar bo'yicha qoldiq (porsiya, vazn bo'yicha)", YES, YES, YES),
    ("Smena qoldig'i: ertaga o'tkazish yoki hisobdan chiqarish", YES, YES, YES),
    ("Chek chop etish (termoprinter)", YES, YES, YES),
    ("Fiskal chek (REGOS:VCR orqali)", YES, YES, YES),
    ("Kunlik hisobot", YES, YES, YES),
    ("Xodimlar: administrator va kassir, PIN-kod bilan qulflash", YES, YES, YES),
    ("Oflayn ishlash, avtomatik zaxira nusxa, yangilanishlar", YES, YES, YES),
    ("section", "Kassalar va ofitsiant telefonlari"),
    ("Kassalar soni (asosiy kassa + yo'ldosh kassalar)", num(1), num(3), num(3)),
    ("Ofitsiant ilovasi: buyurtma Android telefondan" + NEW, NO, num("5 telefon"), num("5 telefon")),
    ("section", "Savdo kengaytmalari"),
    ("Nasiya va qarzdorlar ro'yxati", NO, YES, YES),
    ("To'liq hisobotlar (istalgan davr uchun)", NO, YES, YES),
    ("Chekdagi rasmlar (logotip va boshqalar)", NO, YES, YES),
    ("Bir nechta zal", NO, NO, YES),
    ("section", "Ombor va boshqaruv (Pro tarifi, tez orada)"),
    ("Ombor (mahsulot kirimi va qoldig'i)", NO, NO, SOONTAG),
    ("Inventarizatsiya (sanoq)", NO, NO, SOONTAG),
    ("Hisobdan chiqarish (spisaniye)", NO, NO, SOONTAG),
    ("Taom retsepti / texnologik karta", NO, NO, SOONTAG),
    ("Telegram bot (hisobot va xabarnomalar)", NO, NO, SOONTAG),
]
data = [[Paragraph("Imkoniyat", st("hl", fontName="Arial-Bold", fontSize=10, textColor=colors.white))]
        + [Paragraph(n, HEAD) for n in ("Start", "Standard", "Pro")]]
style = [
    ("BACKGROUND", (0, 0), (-1, 0), INK),
    ("BACKGROUND", (2, 0), (2, 0), ACCENT),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("LINEBELOW", (0, 1), (-1, -1), 0.5, LINE),
    ("TOPPADDING", (0, 0), (-1, -1), 3.4), ("BOTTOMPADDING", (0, 0), (-1, -1), 3.4),
]
for r in rows:
    i = len(data)
    if r[0] == "section":
        data.append([Paragraph(r[1], CELLB), "", "", ""])
        style += [("SPAN", (0, i), (-1, i)), ("BACKGROUND", (0, i), (-1, i), colors.HexColor("#f3f4f6"))]
    else:
        data.append([Paragraph(r[0], CELL)] + [Paragraph(v, CTR) for v in r[1:]])
        style.append(("BACKGROUND", (2, i), (2, i), SOFT))
total = A4[0] - 30 * mm
t = Table(data, colWidths=[total - 3 * 27 * mm] + [27 * mm] * 3, repeatRows=1)
t.setStyle(TableStyle(style))
story.append(t)

story.append(PageBreak())

# Page 2: setup service
story.append(Paragraph("Ustanovka xizmati (oylik tariflar uchun)", H2))
story.append(Paragraph("VIP tariflarida asosiy kassa o'rnatish narxga kiritilgan.", SMALL))
story.append(Spacer(1, 2 * mm))
sdata = [[Paragraph("Xizmat", st("sh1", fontName="Arial-Bold", fontSize=10, textColor=colors.white)),
          Paragraph("Nima kiradi", st("sh2", fontName="Arial-Bold", fontSize=10, textColor=colors.white)),
          Paragraph("Narx, so'm", HEAD)]]
for name, what, price_ in SETUP:
    sdata.append([Paragraph(name, CELLB), Paragraph(what, CELL),
                  Paragraph(f"<b>{price_}</b>", CTR)])
st_tbl = Table(sdata, colWidths=[55 * mm, total - 55 * mm - 30 * mm, 30 * mm])
st_tbl.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), INK),
    ("BACKGROUND", (2, 1), (2, -1), SOFT),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("LINEBELOW", (0, 1), (-1, -1), 0.5, LINE),
    ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
]))
story.append(st_tbl)
story.append(Spacer(1, 2 * mm))
story.append(Spacer(1, 6 * mm))

# Fiscalisation
story.append(Paragraph("Fiskalizatsiya: REGOS", H2))
story.append(Paragraph("Fiskal chek REGOS:VCR orqali, barcha tariflarda.", SMALL))
story.append(Spacer(1, 2 * mm))
WHITE_C = st("whc", fontName="Arial-Bold", fontSize=10, leading=13, alignment=TA_CENTER, textColor=colors.white)
fdata = [[Paragraph(n, WHITE_C) for n, _ in FISCAL] + [Paragraph("Jami", WHITE_C)],
         [Paragraph(f"{som(v)} so'm", CTR) for _, v in FISCAL]
         + [Paragraph(f"<b>{som(sum(v for _, v in FISCAL))} so'm</b>", CTR)]]
fw = total / 4
f_tbl = Table(fdata, colWidths=[fw] * 4)
f_tbl.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), INK),
    ("BACKGROUND", (3, 0), (3, 0), ACCENT),
    ("BACKGROUND", (3, 1), (3, 1), SOFT),
    ("BOX", (0, 0), (-1, -1), 0.5, LINE),
    ("INNERGRID", (0, 1), (-1, -1), 0.5, LINE),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
]))
story.append(f_tbl)
story.append(Spacer(1, 2 * mm))
story.append(Paragraph("Davlat boji va REGOS to'lovlari davlat va REGOS narxlari bo'yicha; ular o'zgarsa, jami ham o'zgaradi.", SMALL))
story.append(Spacer(1, 6 * mm))

notes = [
    Paragraph("Eslatmalar", H2),
    Paragraph("• Yangi kassa 14 kunlik bepul sinov bilan boshlanadi: barcha imkoniyatlar ochiq. Tarif va to'lov: Sozlamalar → Obuna.", BODY),
    Paragraph(f"• VIP: Start VIP {VIP['Start']}, Standard VIP {VIP['Standard']}, Pro VIP {VIP['Pro']} so'm. Tarifning imkoniyatlari "
              "va kassalari, bir marta to'lanadi, muddatsiz. Yuqoriroq VIP'ga o'tishda faqat narx farqi to'lanadi.", BODY),
    Paragraph("• Obuna to'lanmasa, kassa «faqat ko'rish» rejimiga o'tadi: ochiq buyurtmalarni yopish, "
              "smenani yopish va hisobotlarni ko'rish mumkin, ma'lumotlar saqlanib qoladi.", BODY),
]
story.append(KeepTogether(notes))

def footer(c, doc):
    c.saveState()
    c.setFont("Arial", 8)
    c.setFillColor(MUTED)
    c.drawString(15 * mm, 10 * mm, "SavdoChef · Tariflar · 2026")
    c.drawRightString(A4[0] - 15 * mm, 10 * mm, f"{doc.page}")
    c.restoreState()

doc = SimpleDocTemplate(OUT, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm,
                        topMargin=11 * mm, bottomMargin=14 * mm,
                        title="SavdoChef tariflari", author="SavdoChef")
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print("ok", OUT)
