// Reference data loaded on first start. Everything here is editable from the Admin screen.
import { randomBytes } from 'node:crypto';
import { hashPassword } from './auth.js';

// Frequently used ICD-10 (WHO edition, as used in Ghana) codes for a Ghanaian OPD/ward.
// G-DRG codes are intentionally left blank: import the current NHIA tariff mapping
// (Admin → ICD-10 / G-DRG import) so that claims always match the tariff in force.
export const ICD10_COMMON = [
  ['A00.9', 'Cholera, unspecified'],
  ['A01.0', 'Typhoid fever'],
  ['A06.0', 'Acute amoebic dysentery'],
  ['A09.9', 'Gastroenteritis and colitis of unspecified origin'],
  ['A15.0', 'Tuberculosis of lung, confirmed by sputum microscopy with or without culture'],
  ['A16.2', 'Tuberculosis of lung, without mention of bacteriological or histological confirmation'],
  ['A31.1', 'Cutaneous mycobacterial infection (Buruli ulcer)'],
  ['A35', 'Other tetanus'],
  ['A39.0', 'Meningococcal meningitis'],
  ['A41.9', 'Sepsis, unspecified'],
  ['A64', 'Unspecified sexually transmitted disease'],
  ['A82.9', 'Rabies, unspecified'],
  ['B01.9', 'Varicella without complication'],
  ['B05.9', 'Measles without complication'],
  ['B16.9', 'Acute hepatitis B without delta-agent and without hepatic coma'],
  ['B18.1', 'Chronic viral hepatitis B without delta-agent'],
  ['B20', 'HIV disease resulting in infectious and parasitic diseases'],
  ['B24', 'Unspecified human immunodeficiency virus [HIV] disease'],
  ['B35.9', 'Dermatophytosis, unspecified'],
  ['B50.0', 'Plasmodium falciparum malaria with cerebral complications'],
  ['B50.8', 'Other severe and complicated Plasmodium falciparum malaria'],
  ['B50.9', 'Plasmodium falciparum malaria, unspecified'],
  ['B54', 'Unspecified malaria'],
  ['B65.9', 'Schistosomiasis, unspecified'],
  ['B73', 'Onchocerciasis'],
  ['B74.9', 'Filariasis, unspecified'],
  ['B82.9', 'Intestinal parasitism, unspecified'],
  ['B86', 'Scabies'],
  ['C22.0', 'Liver cell carcinoma'],
  ['C50.9', 'Malignant neoplasm of breast, unspecified'],
  ['C53.9', 'Malignant neoplasm of cervix uteri, unspecified'],
  ['C61', 'Malignant neoplasm of prostate'],
  ['D25.9', 'Leiomyoma of uterus, unspecified'],
  ['D50.9', 'Iron deficiency anaemia, unspecified'],
  ['D57.0', 'Sickle-cell anaemia with crisis'],
  ['D57.1', 'Sickle-cell anaemia without crisis'],
  ['D64.9', 'Anaemia, unspecified'],
  ['E03.9', 'Hypothyroidism, unspecified'],
  ['E05.9', 'Thyrotoxicosis, unspecified'],
  ['E10.9', 'Type 1 diabetes mellitus without complications'],
  ['E11.9', 'Type 2 diabetes mellitus without complications'],
  ['E14.9', 'Unspecified diabetes mellitus without complications'],
  ['E43', 'Unspecified severe protein-energy malnutrition'],
  ['E66.9', 'Obesity, unspecified'],
  ['E78.5', 'Hyperlipidaemia, unspecified'],
  ['E86', 'Volume depletion'],
  ['F10.2', 'Mental and behavioural disorders due to use of alcohol: dependence syndrome'],
  ['F20.9', 'Schizophrenia, unspecified'],
  ['F32.9', 'Depressive episode, unspecified'],
  ['F41.9', 'Anxiety disorder, unspecified'],
  ['G03.9', 'Meningitis, unspecified'],
  ['G40.9', 'Epilepsy, unspecified'],
  ['H10.9', 'Conjunctivitis, unspecified'],
  ['H25.9', 'Senile cataract, unspecified'],
  ['H40.9', 'Glaucoma, unspecified'],
  ['H66.9', 'Otitis media, unspecified'],
  ['I10', 'Essential (primary) hypertension'],
  ['I21.9', 'Acute myocardial infarction, unspecified'],
  ['I50.9', 'Heart failure, unspecified'],
  ['I61.9', 'Intracerebral haemorrhage, unspecified'],
  ['I63.9', 'Cerebral infarction, unspecified'],
  ['I64', 'Stroke, not specified as haemorrhage or infarction'],
  ['J02.9', 'Acute pharyngitis, unspecified'],
  ['J03.9', 'Acute tonsillitis, unspecified'],
  ['J06.9', 'Acute upper respiratory infection, unspecified'],
  ['J18.9', 'Pneumonia, unspecified'],
  ['J44.9', 'Chronic obstructive pulmonary disease, unspecified'],
  ['J45.9', 'Asthma, unspecified'],
  ['K02.9', 'Dental caries, unspecified'],
  ['K27.9', 'Peptic ulcer, site unspecified, without haemorrhage or perforation'],
  ['K29.7', 'Gastritis, unspecified'],
  ['K30', 'Dyspepsia'],
  ['K35.8', 'Acute appendicitis, other and unspecified'],
  ['K40.9', 'Unilateral or unspecified inguinal hernia, without obstruction or gangrene'],
  ['K56.6', 'Other and unspecified intestinal obstruction'],
  ['K74.6', 'Other and unspecified cirrhosis of liver'],
  ['K80.2', 'Calculus of gallbladder without cholecystitis'],
  ['L02.9', 'Cutaneous abscess, furuncle and carbuncle, unspecified'],
  ['L03.9', 'Cellulitis, unspecified'],
  ['M10.9', 'Gout, unspecified'],
  ['M17.9', 'Gonarthrosis, unspecified'],
  ['M54.5', 'Low back pain'],
  ['N17.9', 'Acute renal failure, unspecified'],
  ['N18.9', 'Chronic kidney disease, unspecified'],
  ['N30.0', 'Acute cystitis'],
  ['N39.0', 'Urinary tract infection, site not specified'],
  ['N40', 'Hyperplasia of prostate'],
  ['N73.9', 'Female pelvic inflammatory disease, unspecified'],
  ['N76.0', 'Acute vaginitis'],
  ['N97.9', 'Female infertility, unspecified'],
  ['O00.9', 'Ectopic pregnancy, unspecified'],
  ['O03.9', 'Spontaneous abortion, complete or unspecified, without complication'],
  ['O14.1', 'Severe pre-eclampsia'],
  ['O14.9', 'Pre-eclampsia, unspecified'],
  ['O15.9', 'Eclampsia, unspecified as to time period'],
  ['O21.0', 'Mild hyperemesis gravidarum'],
  ['O23.4', 'Unspecified infection of urinary tract in pregnancy'],
  ['O42.9', 'Premature rupture of membranes, unspecified'],
  ['O72.1', 'Other immediate postpartum haemorrhage'],
  ['O80.9', 'Single spontaneous delivery, unspecified'],
  ['O82.9', 'Delivery by caesarean section, unspecified'],
  ['P07.3', 'Other preterm infants'],
  ['P21.9', 'Birth asphyxia, unspecified'],
  ['P36.9', 'Bacterial sepsis of newborn, unspecified'],
  ['P59.9', 'Neonatal jaundice, unspecified'],
  ['R05', 'Cough'],
  ['R10.4', 'Other and unspecified abdominal pain'],
  ['R50.9', 'Fever, unspecified'],
  ['R51', 'Headache'],
  ['R56.0', 'Febrile convulsions'],
  ['S06.0', 'Concussion'],
  ['S52.5', 'Fracture of lower end of radius'],
  ['S72.0', 'Fracture of neck of femur'],
  ['T14.9', 'Injury, unspecified'],
  ['T30.0', 'Burn of unspecified body region, unspecified degree'],
  ['T63.0', 'Toxic effect of snake venom'],
  ['T78.4', 'Allergy, unspecified'],
  ['U07.1', 'COVID-19, virus identified'],
  ['W54', 'Bitten or struck by dog'],
  ['Z00.0', 'General medical examination'],
  ['Z21', 'Asymptomatic human immunodeficiency virus [HIV] infection status'],
  ['Z30.0', 'General counselling and advice on contraception'],
  ['Z34.9', 'Supervision of normal pregnancy, unspecified'],
];

const P = (name, unit, low, high, loinc) => ({ name, unit, low, high, loinc });
const O = (name, options, abnormal = [], loinc) => ({ name, options, abnormal, loinc });
const T = (name, loinc) => ({ name, loinc });
const POSNEG = ['Negative', 'Positive'];
const REACT = ['Non-reactive', 'Reactive'];
const DIP = ['Negative', 'Trace', '+', '++', '+++'];

// Adult reference intervals in SI units. Each laboratory should review and replace these
// with its own validated intervals (Admin → Lab tests).
export const LAB_TESTS = [
  { code: 'FBC', name: 'Full blood count', section: 'Haematology', specimen: 'EDTA blood', params: [
    P('Haemoglobin', 'g/dL', 11.5, 17.5, '718-7'), P('WBC', '×10⁹/L', 4.0, 11.0, '6690-2'),
    P('Platelets', '×10⁹/L', 150, 400, '777-3'), P('Haematocrit', '%', 36, 52, '4544-3'),
    P('MCV', 'fL', 80, 100, '787-2'), P('MCH', 'pg', 27, 32, '785-6'),
    P('Neutrophils', '×10⁹/L', 2.0, 7.5), P('Lymphocytes', '×10⁹/L', 1.0, 4.0),
  ] },
  { code: 'MRDT', name: 'Malaria RDT', section: 'Parasitology', specimen: 'Capillary blood', params: [O('Malaria RDT', POSNEG, ['Positive'])] },
  { code: 'BFMP', name: 'Blood film for malaria parasites', section: 'Parasitology', specimen: 'EDTA blood', params: [
    O('Result', ['No malaria parasites seen', 'P. falciparum seen', 'Other Plasmodium species seen'], ['P. falciparum seen', 'Other Plasmodium species seen'], '32700-7'),
    P('Parasite density', '/µL', null, null),
  ] },
  { code: 'FBS', name: 'Fasting blood glucose', section: 'Chemistry', specimen: 'Fluoride plasma', params: [P('Fasting glucose', 'mmol/L', 3.9, 5.6, '1558-6')] },
  { code: 'RBS', name: 'Random blood glucose', section: 'Chemistry', specimen: 'Fluoride plasma', params: [P('Random glucose', 'mmol/L', 3.9, 7.8, '2345-7')] },
  { code: 'HBA1C', name: 'HbA1c', section: 'Chemistry', specimen: 'EDTA blood', params: [P('HbA1c', '%', 4.0, 5.6, '4548-4')] },
  { code: 'UEC', name: 'Urea, electrolytes & creatinine', section: 'Chemistry', specimen: 'Serum', params: [
    P('Sodium', 'mmol/L', 135, 145, '2951-2'), P('Potassium', 'mmol/L', 3.5, 5.1, '2823-3'),
    P('Chloride', 'mmol/L', 98, 107, '2075-0'), P('Urea', 'mmol/L', 2.5, 7.8),
    P('Creatinine', 'µmol/L', 53, 115, '2160-0'),
  ] },
  { code: 'LFT', name: 'Liver function tests', section: 'Chemistry', specimen: 'Serum', params: [
    P('Total bilirubin', 'µmol/L', 3, 21, '1975-2'), P('Direct bilirubin', 'µmol/L', 0, 5),
    P('ALT', 'U/L', 0, 41, '1742-6'), P('AST', 'U/L', 0, 40, '1920-8'),
    P('ALP', 'U/L', 40, 129, '6768-6'), P('GGT', 'U/L', 0, 60),
    P('Total protein', 'g/L', 64, 83, '2885-2'), P('Albumin', 'g/L', 35, 52, '1751-7'),
  ] },
  { code: 'LIPID', name: 'Lipid profile', section: 'Chemistry', specimen: 'Serum (fasting)', params: [
    P('Total cholesterol', 'mmol/L', null, 5.2, '2093-3'), P('Triglycerides', 'mmol/L', null, 1.7, '2571-8'),
    P('HDL cholesterol', 'mmol/L', 1.0, null, '2085-9'), P('LDL cholesterol', 'mmol/L', null, 3.4, '13457-7'),
  ] },
  { code: 'UA', name: 'Urinalysis (dipstick & microscopy)', section: 'Chemistry', specimen: 'Urine', params: [
    T('Appearance'), P('pH', '', 5, 8), P('Specific gravity', '', 1.005, 1.030),
    O('Protein', DIP, ['+', '++', '+++']), O('Glucose', DIP, ['+', '++', '+++']), O('Blood', DIP, ['Trace', '+', '++', '+++']),
    O('Leucocytes', DIP, ['+', '++', '+++']), O('Nitrite', POSNEG, ['Positive']), O('Ketones', DIP, ['+', '++', '+++']),
    T('Microscopy'),
  ] },
  { code: 'STOOL', name: 'Stool routine examination', section: 'Parasitology', specimen: 'Stool', params: [T('Macroscopy'), T('Microscopy')] },
  { code: 'URINE_CS', name: 'Urine culture & sensitivity', section: 'Microbiology', specimen: 'Urine (MSU)', params: [T('Organism isolated'), T('Colony count'), T('Sensitivity'), T('Resistance')] },
  { code: 'BLOOD_CS', name: 'Blood culture & sensitivity', section: 'Microbiology', specimen: 'Blood culture bottle', params: [T('Organism isolated'), T('Sensitivity'), T('Resistance')] },
  { code: 'AFB', name: 'Sputum AFB (ZN)', section: 'Microbiology', specimen: 'Sputum', params: [O('AFB', ['Negative', 'Scanty', '1+', '2+', '3+'], ['Scanty', '1+', '2+', '3+'])] },
  { code: 'XPERT', name: 'GeneXpert MTB/RIF', section: 'Microbiology', specimen: 'Sputum', params: [
    O('Result', ['MTB not detected', 'MTB detected, RIF resistance not detected', 'MTB detected, RIF resistance detected', 'MTB detected, RIF indeterminate', 'Invalid / error'],
      ['MTB detected, RIF resistance not detected', 'MTB detected, RIF resistance detected', 'MTB detected, RIF indeterminate']),
  ] },
  { code: 'HIV', name: 'HIV 1 & 2 screening', section: 'Serology', specimen: 'Blood', params: [O('HIV 1 & 2', REACT, ['Reactive'])] },
  { code: 'HBSAG', name: 'Hepatitis B surface antigen', section: 'Serology', specimen: 'Serum', params: [O('HBsAg', REACT, ['Reactive'], '5196-1')] },
  { code: 'HCV', name: 'Hepatitis C antibody', section: 'Serology', specimen: 'Serum', params: [O('Anti-HCV', REACT, ['Reactive'])] },
  { code: 'SYPH', name: 'Syphilis screening (RPR/TPHA)', section: 'Serology', specimen: 'Serum', params: [O('Syphilis', REACT, ['Reactive'])] },
  { code: 'WIDAL', name: 'Widal test', section: 'Serology', specimen: 'Serum', params: [T('S. typhi O titre'), T('S. typhi H titre')] },
  { code: 'UHCG', name: 'Urine pregnancy test (hCG)', section: 'Serology', specimen: 'Urine', params: [O('Urine hCG', POSNEG, [], '2106-3')] },
  { code: 'SICKLE', name: 'Sickling test', section: 'Haematology', specimen: 'EDTA blood', params: [O('Sickling', POSNEG, ['Positive'])] },
  { code: 'HBEP', name: 'Haemoglobin electrophoresis', section: 'Haematology', specimen: 'EDTA blood', params: [O('Hb genotype', ['AA', 'AS', 'AC', 'SS', 'SC', 'CC', 'Other'], ['SS', 'SC', 'CC'])] },
  { code: 'GXM', name: 'Blood group & crossmatch', section: 'Haematology', specimen: 'EDTA blood', params: [O('ABO group', ['A', 'B', 'AB', 'O']), O('Rhesus D', ['Positive', 'Negative']), T('Crossmatch / units')] },
  { code: 'G6PD', name: 'G6PD screening', section: 'Haematology', specimen: 'EDTA blood', params: [O('G6PD', ['Normal', 'Partial deficiency', 'Full deficiency'], ['Partial deficiency', 'Full deficiency'])] },
  { code: 'ESR', name: 'ESR', section: 'Haematology', specimen: 'EDTA blood', params: [P('ESR', 'mm/hr', 0, 20, '4537-7')] },
  { code: 'CRP', name: 'C-reactive protein', section: 'Chemistry', specimen: 'Serum', params: [P('CRP', 'mg/L', null, 5, '1988-5')] },
  { code: 'PSA', name: 'Prostate specific antigen', section: 'Chemistry', specimen: 'Serum', params: [P('Total PSA', 'ng/mL', null, 4, '2857-1')] },
  { code: 'TFT', name: 'Thyroid function tests', section: 'Chemistry', specimen: 'Serum', params: [P('TSH', 'mIU/L', 0.27, 4.2, '3016-3'), P('Free T4', 'pmol/L', 12, 22, '3024-7')] },
];

export const WARDS = [
  ['Male Medical', 'Medical', 20], ['Female Medical', 'Medical', 20], ['Surgical', 'Surgical', 20],
  ['Maternity', 'Maternity', 16], ['Paediatric', 'Paediatric', 16], ['Emergency / Detention', 'Emergency', 8],
];

export function seedReference(db) {
  db.tx(() => {
    if (!db.get('SELECT 1 AS x FROM icd10 LIMIT 1')) {
      for (const [code, title] of ICD10_COMMON) db.insert('icd10', { code, title, common: 1 });
    }
    if (!db.get('SELECT 1 AS x FROM lab_tests LIMIT 1')) {
      for (const t of LAB_TESTS) db.insert('lab_tests', { ...t, params: JSON.stringify(t.params) });
    }
    if (!db.get('SELECT 1 AS x FROM wards LIMIT 1')) {
      for (const [name, kind, beds] of WARDS) db.insert('wards', { name, kind, beds });
    }
    if (db.setting('hospital_name') === null) db.setSetting('hospital_name', 'District Hospital');
  });
}

// Create the first administrator. Returns the generated password (if any) so it can be shown once.
export function ensureAdmin(db, envPassword) {
  if (db.get('SELECT 1 AS x FROM users LIMIT 1')) return null;
  const password = envPassword || randomBytes(9).toString('base64url');
  db.insert('users', {
    username: 'admin', full_name: 'System Administrator', role: 'admin',
    password_hash: hashPassword(password), must_change_password: 1,
  });
  return envPassword ? null : password;
}
