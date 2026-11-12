import sys
from fontTools import subset
from fontTools.ttLib import TTFont
src, out = sys.argv[1], sys.argv[2]
chars = set(range(0x20, 0x7F)) | set(range(0xA0, 0x100))
for hi in range(0xB0, 0xC9):
    for lo in range(0xA1, 0xFF):
        chars.add(ord(bytes([hi, lo]).decode('euc-kr')))
chars |= set(range(0x3131, 0x3164))
extra = "×÷±·…“”‘’–—~→←↑↓°′″√∞≈≠≤≥πφλθΔ♩♪♭♯ⅠⅡⅢⅣⅤⅥⅦⅰⅱⅲⅳⅴⅵⅶ★☆▲▼▶◀●○■□✓㎐㎑㎳½⅓¼¾⁰¹²³⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉−∙「」『』〈〉《》、。※"
chars |= {ord(c) for c in extra}
opts = subset.Options()
opts.flavor = 'woff2'
opts.layout_features = ['*']
opts.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
opts.notdef_outline = True
font = TTFont(src)
have = set(font.getBestCmap())
missing = sorted(chars - have)
s = subset.Subsetter(opts)
s.populate(unicodes=chars)
s.subset(font)
font.flavor = 'woff2'
font.save(out)
print('요청', len(chars), '없음', len(missing), ''.join(chr(c) for c in missing))
print('축', [(a.axisTag, a.minValue, a.maxValue) for a in font['fvar'].axes])
