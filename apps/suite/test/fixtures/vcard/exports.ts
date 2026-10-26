// AUTHORED-BY Codex GPT-6.1-Sol
// Entirely synthetic exports illustrating Google/Apple syntax, never real address books.
export const google = String.raw`BEGIN:VCARD
VERSION:3.0
FN:Rowan Example
N:Example;Rowan;River;Dr.;Jr.
EMAIL;TYPE=INTERNET;TYPE=HOME;TYPE=PREF:rowan@example.org
EMAIL;TYPE=WORK:rowan.work@example.org
TEL;TYPE=CELL:+1-202-555-0142
ADR;TYPE=HOME:;;42 Fiction Lane\, Apt 3;Example City;Example Region;00000;Exampleland
ORG:Example\; Works;Research\, Design
TITLE:Imaginary Director
BDAY:1992-03-04
NOTE:First line\nSecond line\; comma\, slash\\end
PHOTO;VALUE=uri:https://example.org/photos/rowan.jpg?size=2,3
CATEGORIES:Friends,Test\, People
X-UNKNOWN:ignored
END:VCARD
`;

export const apple = `BEGIN:VCARD
VERSION:3.0
PRODID:-//Synthetic Apple-style export//EN
FN:Marin Fiction
N:Fiction;Marin;;;
item1.EMAIL;type=INTERNET;type=HOME;type=pref:marin@example.org
item1.X-ABLabel:_$!<Home>!$_
item2.TEL;type=CELL;type=VOICE:+1-202-555-0177
item3.ADR;type=HOME;LABEL="42 Fiction Lane; Example City: Exampleland":;;42 Fiction Lane;Example City;;00000;Exampleland
item3.X-ABADR:us
BDAY:1604-07-09
PHOTO;ENCODING=b;TYPE=JPEG:bm90LWEtcGhvdG8=
NOTE:A folded synthetic note from a fictional contact with enough text to
  continue on the next physical line.
END:VCARD
`;

export const quotedPrintable = `BEGIN:VCARD
VERSION:3.0
FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Zo=C3=AB Example
N;ENCODING=QUOTED-PRINTABLE:Example;Zo=C3=AB;;;
NOTE;ENCODING=QUOTED-PRINTABLE;CHARSET="UTF-8":A=20soft=20=
line=20with=20=C3=
=AB=20and=20=F0=9F=8C=BF=0AEnd
END:VCARD
BEGIN:VCARD
VERSION:3.0
FN;ENCODING=QUOTED-PRINTABLE;CHARSET=ISO-8859-1:Andr=E9 Fiction
N:Fiction;André;;;
END:VCARD
`;

export const version4 = `BEGIN:VCARD
VERSION:4.0
FN:Linden Example
N:Example,Fiction;Linden;A.,B.;Mx.;III
EMAIL;TYPE="work,internet";PREF=1:linden@example.org
TEL;TYPE=cell;PREF=1:tel:+1-202-555-0199;ext=42
TEL;VALUE=text;TYPE=home:Call the fictional front desk
ADR;TYPE=work;LABEL="42 Fiction Lane^nExample City^'Office^'^^":;;42 Fiction Lane,Suite 4;Example City;;00000;Exampleland
ORG:Example Works;Fiction Team
TITLE:Researcher
BDAY:--0709
NOTE:Literal "quotes": they are text.
PHOTO:https://example.org/linden.png
CATEGORIES:Work
CATEGORIES:Research,Example
END:VCARD
`;
