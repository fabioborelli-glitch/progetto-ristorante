# Generates a realistic Italian supplier invoice image for OCR tests
from PIL import Image, ImageDraw, ImageFont
import sys


def font(sz, bold=False):
    for p in ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
              "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"]:
        try:
            return ImageFont.truetype(p, sz)
        except Exception:
            pass
    return ImageFont.load_default()


def make(path, supplier="Ortofrutta Bianchi S.r.l.", lines=None):
    lines = lines or [("TEST_Zucchine Romanesche", "5", "kg", "2,40"),
                      ("TEST_Basilico Genovese", "3", "cf", "1,50"),
                      ("Pomodoro San Marzano", "10", "kg", "1,20")]
    img = Image.new("RGB", (1200, 1000), "white")
    d = ImageDraw.Draw(img)
    d.text((60, 50), supplier, fill="black", font=font(38, True))
    d.text((60, 105), "Via Roma 12, 00100 Roma - P.IVA 01234567890", fill="black", font=font(22))
    d.text((60, 170), "FATTURA N. 2026/0457     Data: 15/01/2026", fill="black", font=font(28, True))
    d.text((60, 220), "Cliente: Trattoria da Fabio", fill="black", font=font(24))
    y = 300
    hdr = [("Descrizione", 60), ("Q.ta", 620), ("U.M.", 760), ("Prezzo unit.", 870), ("Totale", 1060)]
    for t, x in hdr:
        d.text((x, y), t, fill="black", font=font(24, True))
    d.line((50, y + 40, 1150, y + 40), fill="black", width=2)
    y += 60
    for name, q, u, pr in lines:
        tot = f"{float(q.replace(',', '.')) * float(pr.replace(',', '.')):.2f}".replace(".", ",")
        for t, x in [(name, 60), (q, 620), (u, 760), (pr, 870), (tot, 1060)]:
            d.text((x, y), t, fill="black", font=font(24))
        y += 50
    d.line((50, y + 10, 1150, y + 10), fill="black", width=2)
    d.text((800, y + 40), "Imponibile / IVA 4% inclusa a parte", fill="black", font=font(20))
    img.save(path, quality=92)
    return path


if __name__ == "__main__":
    make(sys.argv[1] if len(sys.argv) > 1 else "/tmp/invoice.jpg")
