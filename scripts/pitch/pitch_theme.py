"""Design tokens for the template deck: the template's frame, a monotone ink ramp, one accent.

The Hack2skill template fixes the frame: a black header band with the Google Cloud, AI Builder Cup
and H2S marks, a section title in Google Sans Flex at 16 pt, and a thin black bar at the foot. The
content inside is ours: grey ink on white, amber only for Gapline's own lines (the same amber as the
film and the app), a strike and a cross for anything rejected.
"""

from pptx.dml.color import RGBColor
from pptx.util import Emu, Inches, Pt

from pitch_fonts import FAMILY, FAMILY_MEDIUM, FAMILY_SEMIBOLD, KOREAN_FAMILY

SLIDE_W = Emu(9144000)
SLIDE_H = Emu(5143500)

# The template's frame (read from its content slides).
HEADER_BOTTOM = Inches(0.555)
FOOTER_TOP = Emu(5071875)
TITLE_X = Emu(265350)
TITLE_Y = Emu(663825)

# Content grid: the left edge lines up with the section title's glyphs (box x + 0.1 in inset).
LEFT = Inches(0.39)
RIGHT = SLIDE_W - Inches(0.39)
CONTENT_W = RIGHT - LEFT
HEADLINE_Y = Inches(1.08)
BODY_TOP = Inches(1.72)
BODY_BOTTOM = Inches(5.36)
GUTTER = Inches(0.22)

INK = RGBColor(0x20, 0x21, 0x24)
INK_2 = RGBColor(0x3C, 0x40, 0x43)
INK_3 = RGBColor(0x5F, 0x63, 0x68)
RULE = RGBColor(0xDA, 0xDC, 0xE0)
RULE_STRONG = RGBColor(0x9A, 0xA0, 0xA6)
SURFACE = RGBColor(0xF8, 0xF9, 0xFA)
SURFACE_2 = RGBColor(0xF1, 0xF3, 0xF4)
SPEECH = RGBColor(0x80, 0x86, 0x8B)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
AMBER = RGBColor(0xF1, 0xB5, 0x4B)
AMBER_EDGE = RGBColor(0xB0, 0x7A, 0x16)
AMBER_SOFT = RGBColor(0xFC, 0xEF, 0xD6)

# Text styles: (family, size in pt, color). Bold and italic are run flags on FAMILY only.
SECTION = (FAMILY_MEDIUM, 16, INK)
HEADLINE = (FAMILY_SEMIBOLD, 22, INK)
LEAD = (FAMILY, 14, INK_2)
BODY = (FAMILY, 12.5, INK_2)
BODY_STRONG = (FAMILY_SEMIBOLD, 12.5, INK)
CARD_TITLE = (FAMILY_SEMIBOLD, 12.5, INK)
SMALL = (FAMILY, 11, INK_2)
LABEL = (FAMILY_MEDIUM, 10.5, INK_3)
FINE = (FAMILY, 9, INK_3)
NOTE = (FAMILY, 8, INK_2)
NOTE_HEAD = (FAMILY_MEDIUM, 8, INK)
KOREAN = KOREAN_FAMILY

# Floors the build enforces: body text on slide faces, fine print (credits, axes), the notes page.
MIN_FACE_PT = 9
MIN_NOTES_PT = 8
LINE_SPACING = 1.12
HAIRLINE = Pt(0.75)
