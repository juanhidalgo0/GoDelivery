# Banner de bienvenida del bot de WhatsApp (public/wa-banner.jpg, 1200x630).
# Colores de la marca (src/styles/go-brand.css), logo y moto de public/. Regenerar:
#   python scripts/make-wa-banner.py
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.join(ROOT, "public")
W, H = 1200, 630
INK, RED, PAPER = (11, 11, 12), (225, 29, 72), (244, 242, 238)
GRAY = (92, 90, 86)

def font(name, size):
    return ImageFont.truetype(os.path.join(os.environ.get("WINDIR", "C:/Windows"), "Fonts", name), size)

img = Image.new("RGB", (W, H), PAPER)
d = ImageDraw.Draw(img)

# Bloque rojo a la derecha, con la moto encima
d.ellipse((690, 70, 1250, 630), fill=RED)
d.rectangle((0, H - 14, W, H), fill=INK)

moto = Image.open(os.path.join(PUB, "go-delivery-moto.png")).convert("RGBA")
moto = moto.resize((int(moto.width * 0.86), int(moto.height * 0.86)), Image.LANCZOS)
shadow = Image.new("RGBA", img.size, (0, 0, 0, 0))
ImageDraw.Draw(shadow).ellipse((690, 560, 1150, 600), fill=(0, 0, 0, 70))
img.paste(shadow.filter(ImageFilter.GaussianBlur(10)), (0, 0), shadow.filter(ImageFilter.GaussianBlur(10)))
img.paste(moto, (585, 52), moto)

# Logo redondo
logo = Image.open(os.path.join(PUB, "logo-brand.jpg")).convert("RGB").resize((132, 132), Image.LANCZOS)
mask = Image.new("L", logo.size, 0)
ImageDraw.Draw(mask).ellipse((0, 0, 131, 131), fill=255)
img.paste(logo, (64, 60), mask)

# Textos
d.text((64, 232), "Pedí lo que", font=font("seguibl.ttf", 78), fill=INK)
d.text((64, 318), "necesites.", font=font("seguibl.ttf", 78), fill=INK)
d.text((66, 422), "Mandados, comercios y envíos", font=font("segoeuib.ttf", 30), fill=GRAY)
d.text((66, 460), "en Magdalena", font=font("segoeuib.ttf", 30), fill=GRAY)

# Píldora roja
pill = "Escribinos por acá"
f = font("segoeuib.ttf", 28)
tw = d.textlength(pill, font=f)
d.rounded_rectangle((64, 524, 64 + tw + 56, 580), radius=28, fill=RED)
d.text((92, 531), pill, font=f, fill=(255, 255, 255))

out = os.path.join(PUB, "wa-banner.jpg")
img.save(out, "JPEG", quality=88, optimize=True, progressive=True)
print(out, os.path.getsize(out), "bytes")
