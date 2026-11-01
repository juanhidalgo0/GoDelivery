# Encabezado del formulario nativo del bot (functions/whatsapp/flows/header.jpg, 1200x480).
# Mismo estilo que el banner (scripts/make-wa-banner.py). scripts/wa-flow.mjs lo mete en el JSON
# del formulario como base64, así que conviene que pese poco. Regenerar:
#   python scripts/make-wa-flow-header.py
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.join(ROOT, "public")
W, H = 1200, 480
INK, RED, PAPER = (11, 11, 12), (225, 29, 72), (244, 242, 238)
GRAY = (92, 90, 86)

def font(name, size):
    return ImageFont.truetype(os.path.join(os.environ.get("WINDIR", "C:/Windows"), "Fonts", name), size)

img = Image.new("RGB", (W, H), PAPER)
d = ImageDraw.Draw(img)

# Círculo rojo con la moto, recortado por el borde derecho
d.ellipse((700, 20, 1220, 540), fill=RED)
moto = Image.open(os.path.join(PUB, "go-delivery-moto.png")).convert("RGBA")
moto = moto.resize((int(moto.width * 0.68), int(moto.height * 0.68)), Image.LANCZOS)
shadow = Image.new("RGBA", img.size, (0, 0, 0, 0))
ImageDraw.Draw(shadow).ellipse((700, 440, 1090, 472), fill=(0, 0, 0, 70))
blur = shadow.filter(ImageFilter.GaussianBlur(10))
img.paste(blur, (0, 0), blur)
img.paste(moto, (640, 30), moto)

# Logo redondo
logo = Image.open(os.path.join(PUB, "logo-brand.jpg")).convert("RGB").resize((120, 120), Image.LANCZOS)
mask = Image.new("L", logo.size, 0)
ImageDraw.Draw(mask).ellipse((0, 0, 119, 119), fill=255)
img.paste(logo, (64, 40), mask)

# Textos grandes: en el celular la imagen se ve a ~340 px de ancho
d.text((60, 180), "Último paso", font=font("seguibl.ttf", 96), fill=INK)
pill = "Entrega y pago"
f = font("segoeuib.ttf", 40)
tw = d.textlength(pill, font=f)
d.rounded_rectangle((64, 318, 64 + tw + 68, 392), radius=37, fill=RED)
d.text((98, 326), pill, font=f, fill=(255, 255, 255))

out = os.path.join(ROOT, "functions", "whatsapp", "flows", "header.jpg")
img.save(out, "JPEG", quality=80, optimize=True, progressive=False)
print(out, os.path.getsize(out), "bytes")
