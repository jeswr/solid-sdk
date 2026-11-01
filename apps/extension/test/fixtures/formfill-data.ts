// AUTHORED-BY Codex GPT-6.1-Sol
export const webId = 'https://pod.example/profile/card#me';
export const baseUrl = 'https://pod.example/contacts/alice.ttl';

export const vcardTurtle = `
@prefix vcard: <http://www.w3.org/2006/vcard/ns#>.
@prefix schema: <https://schema.org/>.
<${webId}> vcard:fn "Alice Example", "Later Name" ;
  vcard:given-name "Alice" ; vcard:family-name "Example" ;
  vcard:organization-name "Example Ltd" ;
  vcard:hasEmail <mailto:first@example.test>,
    [ vcard:pref 2; vcard:hasValue <mailto:second@example.test> ],
    [ vcard:pref 1; vcard:hasValue <mailto:preferred@example.test> ],
    [ vcard:pref 1; vcard:hasValue <mailto:tied@example.test> ] ;
  vcard:hasTelephone [ vcard:hasValue <tel:+440000000000> ],
    [ a vcard:Pref; vcard:hasValue <tel:+441234567890> ] ;
  vcard:hasAddress [ vcard:street-address "Old street" ], <#home> ;
  schema:name "Schema fallback must lose" ; schema:email "fallback@example.test" .
<#home> vcard:pref true ; vcard:street-address "12 River Road" ;
  vcard:extended-address "Flat 3" ; vcard:locality "Oxford" ;
  vcard:region "Oxfordshire" ; vcard:postal-code "OX1 1AA" ; vcard:country-name "United Kingdom" .
<https://other.example/#me> vcard:fn "Someone Else" ; vcard:hasEmail <mailto:someone@example.test> .
`;

export const schemaTurtle = `
@prefix schema: <http://schema.org/>.
<${webId}> schema:name "Bob Builder"; schema:givenName "Bob"; schema:familyName "Builder";
  schema:email <mailto:bob@example.test>; schema:telephone "TEL:+12025550123";
  schema:address [ a schema:PostalAddress; schema:streetAddress "1 Main Street";
    schema:addressLocality "Springfield"; schema:addressRegion "IL";
    schema:postalCode "62701"; schema:addressCountry "US" ] .
`;
