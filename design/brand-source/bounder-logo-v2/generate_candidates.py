from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


OUT = Path(__file__).parent
SIZE = 1200


def canvas():
    return Image.new("RGB", (SIZE, SIZE), "white")


def bounded_o():
    image = canvas()
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((145, 145, 1055, 1055), radius=215, outline="black", width=155)
    draw.rectangle((875, 390, 1199, 810), fill="white")
    draw.rounded_rectangle((972, 430, 1090, 770), radius=42, fill="black")
    return image


def interlock_brackets():
    image = canvas()
    draw = ImageDraw.Draw(image)
    stroke = 145
    draw.rounded_rectangle((150, 150, 300, 1050), radius=55, fill="black")
    draw.rounded_rectangle((150, 150, 525, 300), radius=55, fill="black")
    draw.rounded_rectangle((150, 900, 525, 1050), radius=55, fill="black")
    draw.rounded_rectangle((900, 150, 1050, 1050), radius=55, fill="black")
    draw.rounded_rectangle((675, 150, 1050, 300), radius=55, fill="black")
    draw.rounded_rectangle((675, 900, 1050, 1050), radius=55, fill="black")
    draw.rounded_rectangle((540, 400, 660, 800), radius=42, fill="black")
    return image


def threshold_b():
    image = canvas()
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((155, 145, 330, 1055), radius=65, fill="black")
    draw.rounded_rectangle((250, 145, 910, 605), radius=210, outline="black", width=145)
    draw.rounded_rectangle((250, 595, 910, 1055), radius=210, outline="black", width=145)
    draw.rectangle((760, 465, 1030, 735), fill="white")
    draw.rounded_rectangle((895, 500, 1015, 700), radius=40, fill="black")
    return image


def grounded_o():
    image = canvas()
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((145, 145, 1055, 1055), radius=215, outline="black", width=155)
    draw.rectangle((385, 875, 815, 1199), fill="white")
    draw.rounded_rectangle((430, 970, 770, 1090), radius=42, fill="black")
    return image


candidates = {
    "01-bounded-o": bounded_o(),
    "02-interlock-brackets": interlock_brackets(),
    "03-threshold-b": threshold_b(),
    "04-grounded-o": grounded_o(),
}

for name, image in candidates.items():
    image.save(OUT / f"{name}-source.png")

sheet = Image.new("RGB", (SIZE * 4, SIZE + 160), "#ecefe9")
font = ImageFont.load_default(size=42)
labels = ["BOUNDED O", "INTERLOCK BRACKETS", "THRESHOLD B", "GROUNDED O"]
for index, ((_, image), label) in enumerate(zip(candidates.items(), labels)):
    sheet.paste(image, (index * SIZE, 0))
    draw = ImageDraw.Draw(sheet)
    draw.text((index * SIZE + 60, SIZE + 50), label, fill="#11130f", font=font)
sheet.save(OUT / "candidate-sheet.png")


def tracked_text(draw, position, text, font, tracking):
    x, y = position
    for character in text:
        draw.text((x, y), character, font=font, fill="black")
        x += draw.textlength(character, font=font) + tracking
    return x


lockup = Image.new("RGB", (3000, 720), "white")
lockup_draw = ImageDraw.Draw(lockup)
lockup_font = ImageFont.truetype("/System/Library/Fonts/Avenir Next.ttc", 390, index=8)
text_y = 78
x = tracked_text(lockup_draw, (80, text_y), "B", lockup_font, 18)
x += 12
mark_top = 157
mark_size = 305
mark_stroke = 52
lockup_draw.rounded_rectangle(
    (x, mark_top, x + mark_size, mark_top + mark_size),
    radius=72,
    outline="black",
    width=mark_stroke,
)
lockup_draw.rectangle((x + 245, mark_top + 102, x + mark_size + 5, mark_top + 203), fill="white")
lockup_draw.rounded_rectangle((x + 277, mark_top + 112, x + 316, mark_top + 193), radius=13, fill="black")
x += mark_size + 35
tracked_text(lockup_draw, (x, text_y), "UNDER", lockup_font, 18)
lockup_bbox = lockup.getbbox()
lockup = lockup.crop((lockup_bbox[0], lockup_bbox[1], lockup_bbox[2], lockup_bbox[3]))
lockup.save(OUT / "bounder-wordmark-source.png")
