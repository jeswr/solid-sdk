// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
export const ENVR = "https://jeswr.org/ns/sectors/environment#";
export const SOSA = "http://www.w3.org/ns/sosa/";
export const QUDT = "http://qudt.org/schema/qudt/";
export const UNIT = "http://qudt.org/vocab/unit/";
export const QUANTITY_KIND = "http://qudt.org/vocab/quantitykind/";
export const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
export const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
export const XSD = "http://www.w3.org/2001/XMLSchema#";
export const SCHEMA = "https://schema.org/";
export const PROPERTY = Object.freeze({
  CO2Concentration: `${ENVR}CO2Concentration`,
  // biome-ignore lint/style/useNamingConvention: preserve the authorized vocabulary spelling.
  PM2_5MassConcentration: `${ENVR}PM2_5MassConcentration`,
  PM10MassConcentration: `${ENVR}PM10MassConcentration`,
  VOCIndex: `${ENVR}VOCIndex`,
  AirQualityIndex: `${ENVR}AirQualityIndex`,
  AirTemperature: `${ENVR}AirTemperature`,
  RelativeHumidity: `${ENVR}RelativeHumidity`,
  FanSpeedLevel: `${ENVR}FanSpeedLevel`,
  FilterLifeRemaining: `${ENVR}FilterLifeRemaining`,
} as const);
export const UNITS = Object.freeze({
  PPM: `${UNIT}PPM`,
  MICROGM_PER_M3: `${UNIT}MicroGM-PER-M3`,
  DEG_C: `${UNIT}DEG_C`,
  PERCENT: `${UNIT}PERCENT`,
  UNITLESS: `${UNIT}UNITLESS`,
} as const);
export type ObservableProperty = (typeof PROPERTY)[keyof typeof PROPERTY];
export type ObservationUnit = (typeof UNITS)[keyof typeof UNITS];
export const PROPERTY_UNITS: Readonly<Record<ObservableProperty, ObservationUnit>> = Object.freeze({
  [PROPERTY.CO2Concentration]: UNITS.PPM,
  [PROPERTY.PM2_5MassConcentration]: UNITS.MICROGM_PER_M3,
  [PROPERTY.PM10MassConcentration]: UNITS.MICROGM_PER_M3,
  [PROPERTY.VOCIndex]: UNITS.UNITLESS,
  [PROPERTY.AirQualityIndex]: UNITS.UNITLESS,
  [PROPERTY.AirTemperature]: UNITS.DEG_C,
  [PROPERTY.RelativeHumidity]: UNITS.PERCENT,
  [PROPERTY.FanSpeedLevel]: UNITS.UNITLESS,
  [PROPERTY.FilterLifeRemaining]: UNITS.PERCENT,
});
export const PREFIXES = Object.freeze({
  envr: ENVR,
  sosa: SOSA,
  qudt: QUDT,
  unit: UNIT,
  rdfs: RDFS,
  rdf: RDF,
  xsd: XSD,
  schema: SCHEMA,
});

export const RDF_TYPE = `${RDF}type`;
export const SOSA_OBSERVATION = `${SOSA}Observation`;
export const SOSA_RESULT_TIME = `${SOSA}resultTime`;
