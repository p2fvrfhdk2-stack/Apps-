import { h, mount, api, can, state, table, fullName, sexAge, buildForm, toast, debounce, clear, nhisStatus, section } from '../lib.js';

export async function patientListView(el) {
  const params = new URLSearchParams((location.hash.split('?')[1]) || '');
  const input = h('input', { type: 'search', class: 'big-search', value: params.get('q') || '', placeholder: 'Name, folder no., phone, NHIS no. or Ghana Card', 'aria-label': 'Search patients' });
  const results = h('div');
  const load = async () => {
    const q = input.value.trim();
    const rows = await api(`/api/patients?q=${encodeURIComponent(q)}`);
    clear(results).append(
      h('p', { class: 'muted small' }, q ? `${rows.length} match${rows.length === 1 ? '' : 'es'}` : 'Recently registered'),
      table([
        { label: 'Folder no.', key: 'folder_no' },
        { label: 'Name', render: (r) => h('b', null, fullName(r)) },
        { label: 'Sex / age', render: (r) => sexAge(r) },
        { label: 'Phone', key: 'phone' },
        { label: 'NHIS', render: (r) => { const n = nhisStatus(r); return n ? h('span', { class: `badge ${n.ok ? 'ok' : 'warn'}` }, r.nhis_no) : '—'; } },
        { label: 'Ghana Card', key: 'ghana_card' },
      ], rows, { empty: 'No patient found. Check the spelling or register a new patient.', onRowClick: (r) => { location.hash = `#/patients/${r.id}`; } }));
  };
  input.addEventListener('input', debounce(load, 300));
  mount(el, 
    h('div', { class: 'page-head' }, h('h1', null, 'Patients'), can('patient.write') ? h('a', { class: 'btn primary', href: '#/patients/new' }, '+ Register patient') : null),
    h('div', { class: 'search-row' }, input), results);
  await load();
  input.focus();
}

export async function patientFormView(el, id) {
  const m = state.meta;
  let p = {};
  if (id) p = (await api(`/api/patients/${id}`)).patient;
  const fields = [
    { heading: 'Identity' },
    { key: 'folder_no', label: 'Folder number', placeholder: id ? '' : 'Leave blank to auto-generate', help: 'Enter the existing number for patients with an old paper folder.' },
    { key: 'title', label: 'Title', type: 'select', options: ['Mr', 'Mrs', 'Miss', 'Ms', 'Master', 'Dr', 'Rev', 'Prof', 'Nana', 'Hon'] },
    { key: 'first_name', label: 'First name', required: true },
    { key: 'middle_name', label: 'Middle name(s)' },
    { key: 'last_name', label: 'Surname', required: true },
    { key: 'sex', label: 'Sex', type: 'select', options: [['M', 'Male'], ['F', 'Female']], required: true },
    { key: 'dob', label: 'Date of birth', type: 'date' },
    { key: 'age_years', label: 'or age in years (if DOB unknown)', type: 'number', help: 'Sets an estimated date of birth.' },
    { key: 'dob_estimated', label: 'Date of birth is estimated', type: 'checkbox' },
    { heading: 'IDs & insurance' },
    { key: 'ghana_card', label: 'Ghana Card no.', placeholder: 'GHA-123456789-0' },
    { key: 'nhis_no', label: 'NHIS membership no.' },
    { key: 'nhis_expiry', label: 'NHIS expiry date', type: 'date' },
    { heading: 'Contact' },
    { key: 'phone', label: 'Phone', type: 'tel', placeholder: '024 000 0000' },
    { key: 'address', label: 'Residential address / landmark' },
    { key: 'gps_address', label: 'GhanaPost GPS address', placeholder: 'GA-123-4567' },
    { key: 'hometown', label: 'Hometown' },
    { key: 'region', label: 'Region', type: 'select', options: m.regions },
    { key: 'occupation', label: 'Occupation' },
    { key: 'religion', label: 'Religion', type: 'select', options: ['Christian', 'Muslim', 'Traditional', 'Other', 'None'] },
    { key: 'marital_status', label: 'Marital status', type: 'select', options: ['Single', 'Married', 'Cohabiting', 'Divorced', 'Widowed'] },
    { heading: 'Clinical' },
    { key: 'allergies', label: 'Allergies (drug, food) – leave blank if none known', span: 'half' },
    { key: 'blood_group', label: 'Blood group', type: 'select', options: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] },
    { heading: 'Next of kin' },
    { key: 'nok_name', label: 'Name' },
    { key: 'nok_relation', label: 'Relationship' },
    { key: 'nok_phone', label: 'Phone', type: 'tel' },
  ];
  const form = buildForm(fields, p);
  form.inputs.age_years.addEventListener('input', () => {
    const y = Number(form.inputs.age_years.value);
    if (y > 0 && y < 130) {
      form.inputs.dob.value = `${new Date().getFullYear() - Math.floor(y)}-07-01`;
      form.inputs.dob_estimated.checked = true;
    }
  });
  const save = async (e) => {
    e.preventDefault();
    if (!form.validate()) return;
    const v = form.values();
    delete v.age_years;
    try {
      if (id) {
        await api(`/api/patients/${id}`, { method: 'PUT', body: v });
        toast('Patient details saved');
        location.hash = `#/patients/${id}`;
      } else {
        const r = await api('/api/patients', { method: 'POST', body: v });
        toast(`Patient registered – folder ${r.folder_no}`);
        location.hash = `#/patients/${r.id}`;
      }
    } catch (err) { toast(err.message, 'error'); }
  };
  mount(el, 
    h('div', { class: 'page-head' }, h('h1', null, id ? `Edit patient – ${fullName(p)}` : 'Register new patient')),
    h('form', { onsubmit: save }, section('Patient details', form.el),
      h('div', { class: 'form-actions' },
        h('a', { class: 'btn', href: id ? `#/patients/${id}` : '#/patients' }, 'Cancel'),
        h('button', { class: 'btn primary', type: 'submit' }, id ? 'Save changes' : 'Register patient'))));
}
