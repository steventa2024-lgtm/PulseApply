/**
 * Skill and certification dictionary used to extract requirements from job
 * text and qualifications from resumes. Aliases are matched as whole phrases.
 *
 * `transferable` skills are general soft skills. They can earn partial credit
 * but are never evidence of occupation-specific qualification.
 */
export interface SkillDef {
  id: string
  label: string
  aliases: string[]
  transferable?: boolean
}

export interface CertificationDef {
  id: string
  label: string
  aliases: string[]
}

const S = (id: string, label: string, aliases: string[], transferable = false): SkillDef => ({ id, label, aliases, transferable })

export const SKILLS: SkillDef[] = [
  // transferable
  S('customer_service', 'Customer service', ['customer service', 'customer-service', 'guest service', 'guest experience', 'customer experience', 'serving customers', 'client service'], true),
  S('communication', 'Communication', ['communication skills', 'verbal communication', 'written communication', 'communicate effectively', 'strong communicator', 'interpersonal skills'], true),
  S('teamwork', 'Teamwork', ['teamwork', 'team player', 'collaborat', 'work well with others', 'team environment'], true),
  S('time_management', 'Time management', ['time management', 'punctual', 'punctuality', 'meet deadlines', 'reliable attendance', 'dependable'], true),
  S('problem_solving', 'Problem solving', ['problem solving', 'problem-solving', 'troubleshoot issues', 'critical thinking'], true),
  S('attention_to_detail', 'Attention to detail', ['attention to detail', 'detail oriented', 'detail-oriented', 'accuracy'], true),
  S('multitasking', 'Multitasking', ['multitask', 'multi-task', 'fast-paced', 'fast paced', 'high-volume', 'high volume'], true),
  S('organization', 'Organization', ['organizational skills', 'organized', 'organisation skills'], true),
  S('adaptability', 'Adaptability', ['adaptable', 'flexible schedule', 'flexibility', 'adaptability'], true),
  S('bilingual', 'Bilingual', ['bilingual', 'spanish speaking', 'fluent in spanish', 'multilingual'], true),
  S('physical_stamina', 'Physical stamina', ['stand for long periods', 'on your feet', 'physically demanding', 'standing for extended'], true),
  // warehouse & logistics
  S('inventory', 'Inventory management', ['inventory', 'stock control', 'stock management', 'inventory management', 'inventory control']),
  S('forklift', 'Forklift operation', ['forklift', 'fork lift', 'reach truck', 'lift truck', 'order picker truck']),
  S('pallet_jack', 'Pallet jack', ['pallet jack', 'electric pallet jack', 'pallet truck', 'hand truck', 'dolly']),
  S('rf_scanner', 'RF scanner', ['rf scanner', 'rf gun', 'handheld scanner', 'barcode scanner', 'scan gun']),
  S('shipping_receiving', 'Shipping & receiving', ['shipping and receiving', 'shipping & receiving', 'receiving', 'shipping', 'bill of lading', 'bol']),
  S('order_picking', 'Order picking', ['order picking', 'picking orders', 'pick and pack', 'pick orders', 'order fulfillment', 'order fulfilment']),
  S('packing', 'Packing', ['packing', 'packaging orders', 'pack orders', 'boxing']),
  S('loading', 'Loading/unloading', ['loading', 'unloading', 'load trucks', 'unload trucks', 'trailer loading']),
  S('stocking', 'Stocking', ['stocking', 'restocking', 'replenish', 'shelving', 'stock shelves', 'face shelves']),
  S('wms', 'Warehouse management systems', ['wms', 'warehouse management system', 'manhattan scale', 'sap ewm', 'highjump']),
  S('cycle_counting', 'Cycle counting', ['cycle count', 'cycle counting', 'physical inventory']),
  S('heavy_lifting', 'Lifting up to 50 lbs', ['lift 50', 'lift up to 50', 'lift 50 lbs', 'lift up to 25', 'heavy lifting', 'lift heavy', 'lifting up to', 'lift up to 70', 'lift 23 kg']),
  S('warehouse_safety', 'Warehouse safety', ['osha', 'safety procedures', 'safety protocols', 'ppe', 'safety standards']),
  S('logistics', 'Logistics', ['logistics', 'supply chain', 'freight', 'carrier management', 'transportation management']),
  S('erp', 'ERP systems', ['erp', 'sap', 'oracle netsuite', 'netsuite', 'microsoft dynamics']),
  S('dispatching', 'Dispatching', ['dispatch', 'dispatching', 'route scheduling']),
  S('driving', 'Driving', ['driving', 'drive a vehicle', 'clean driving record', 'safe driving', 'driving record']),
  S('route_planning', 'Route planning', ['route planning', 'navigation', 'gps', 'delivery routes', 'multi-stop']),
  S('customer_delivery', 'Customer deliveries', ['deliver packages', 'delivering packages', 'package delivery', 'deliveries']),
  S('dot_compliance', 'DOT compliance', ['dot regulations', 'dot compliance', 'hours of service', 'eld', 'pre-trip inspection', 'pre trip inspection']),
  // food service
  S('espresso', 'Espresso preparation', ['espresso', 'espresso machine', 'espresso drinks', 'pulling shots']),
  S('milk_steaming', 'Milk steaming', ['milk steaming', 'steam milk', 'steaming milk', 'milk frothing', 'microfoam']),
  S('latte_art', 'Latte art', ['latte art']),
  S('coffee_brewing', 'Coffee brewing', ['coffee brewing', 'brew coffee', 'pour over', 'pour-over', 'drip coffee', 'cold brew', 'coffee preparation', 'specialty coffee']),
  S('beverage_prep', 'Beverage preparation', ['beverage preparation', 'drink preparation', 'prepare beverages', 'make drinks', 'blended beverages', 'beverages']),
  S('pos', 'POS systems', ['pos', 'point of sale', 'point-of-sale', 'cash register', 'square pos', 'toast pos', 'clover', 'micros', 'register']),
  S('cash_handling', 'Cash handling', ['cash handling', 'handling cash', 'cash management', 'count cash', 'balance drawer', 'cash drawer', 'till']),
  S('food_safety', 'Food safety & sanitation', ['food safety', 'food handling', 'food handler', 'sanitation standards', 'haccp', 'health code', 'servsafe', 'food hygiene']),
  S('opening_closing', 'Opening/closing procedures', ['opening and closing', 'open and close', 'opening procedures', 'closing procedures', 'closing duties']),
  S('food_prep', 'Food preparation', ['food prep', 'food preparation', 'prep food', 'prepare food', 'meal prep']),
  S('cooking', 'Cooking', ['cooking', 'grill', 'fryer', 'saute', 'line cooking', 'culinary']),
  S('knife_skills', 'Knife skills', ['knife skills', 'knife handling']),
  S('kitchen_equipment', 'Kitchen equipment', ['commercial kitchen', 'kitchen equipment', 'dish machine', 'dishwashing machine']),
  S('sanitation', 'Sanitation', ['sanitation', 'sanitizing', 'sanitize', 'disinfect']),
  S('table_service', 'Table service', ['table service', 'take orders', 'taking orders', 'serve food', 'fine dining', 'table side']),
  S('upselling', 'Upselling', ['upsell', 'upselling', 'suggestive selling', 'sales goals']),
  S('menu_knowledge', 'Menu knowledge', ['menu knowledge', 'menu items']),
  S('mixology', 'Mixology', ['mixology', 'cocktails', 'mix drinks', 'craft cocktails']),
  S('alcohol_compliance', 'Responsible alcohol service', ['responsible alcohol', 'check ids', 'carding']),
  S('team_leadership', 'Team leadership', ['team leadership', 'supervise staff', 'supervising staff', 'lead a team', 'leading a team', 'manage a team', 'supervisory experience', 'train new employees', 'coach team members', 'people management']),
  S('scheduling', 'Scheduling', ['scheduling', 'schedule management', 'staff schedules', 'shift scheduling', 'appointment scheduling', 'schedule appointments']),
  S('pnl', 'P&L management', ['p&l', 'profit and loss', 'budget management', 'labor costs', 'cost control']),
  S('hiring', 'Hiring', ['hiring', 'recruit and hire', 'interviewing candidates']),
  // retail
  S('merchandising', 'Merchandising', ['merchandising', 'visual merchandising', 'product displays', 'displays']),
  S('planograms', 'Planograms', ['planogram', 'planograms']),
  // hospitality
  S('hotel_pms', 'Hotel PMS', ['opera pms', 'property management system', 'hotel pms', 'onq', 'fosse']),
  S('reservations', 'Reservations', ['reservations', 'booking', 'bookings']),
  S('check_in', 'Guest check-in/out', ['check-in', 'check in guests', 'check-out', 'checkout guests']),
  S('guest_relations', 'Guest relations', ['guest relations', 'guest satisfaction', 'guest complaints', 'hospitality']),
  S('cleaning', 'Cleaning', ['cleaning', 'clean rooms', 'vacuum', 'mopping', 'dusting']),
  S('laundry', 'Laundry', ['laundry', 'linens']),
  S('floor_care', 'Floor care', ['floor care', 'buffing', 'stripping and waxing', 'floor scrubber']),
  // office
  S('ms_office', 'Microsoft Office', ['microsoft office', 'ms office', 'microsoft word', 'ms word', 'outlook', 'powerpoint', 'office 365', 'google workspace', 'g suite']),
  S('excel', 'Excel / spreadsheets', ['excel', 'spreadsheets', 'spreadsheet', 'google sheets', 'vlookup', 'pivot tables']),
  S('data_entry', 'Data entry', ['data entry', 'enter data', 'keying', 'data input', 'record keeping', 'recordkeeping']),
  S('typing', 'Typing', ['typing', 'wpm', 'words per minute', 'keyboarding']),
  S('filing', 'Filing & records', ['filing', 'records management', 'document management', 'file management']),
  S('calendar_management', 'Calendar management', ['calendar management', 'manage calendars', 'calendars', 'travel arrangements']),
  S('phone_etiquette', 'Phone handling', ['answer phones', 'answering phones', 'phone etiquette', 'multi-line phone', 'inbound calls', 'phone calls', 'switchboard']),
  S('bookkeeping_basic', 'Basic bookkeeping', ['invoicing', 'petty cash', 'expense reports', 'invoices']),
  S('vendor_management', 'Vendor management', ['vendor management', 'vendor relations', 'suppliers', 'procurement', 'purchasing']),
  S('crm', 'CRM software', ['crm', 'customer relationship management', 'zendesk', 'hubspot crm', 'freshdesk']),
  S('ticketing', 'Ticketing systems', ['ticketing system', 'ticketing', 'servicenow', 'jira service', 'help desk software', 'zendesk']),
  S('conflict_resolution', 'Conflict resolution', ['de-escalate', 'de-escalation', 'conflict resolution', 'resolve complaints', 'handle complaints']),
  // healthcare
  S('vital_signs', 'Vital signs', ['vital signs', 'vitals', 'blood pressure', 'take vitals']),
  S('ehr', 'EHR/EMR systems', ['ehr', 'emr', 'electronic health records', 'electronic medical records', 'epic', 'cerner', 'athenahealth', 'eclinicalworks']),
  S('phlebotomy', 'Phlebotomy', ['phlebotomy', 'venipuncture', 'blood draw', 'draw blood']),
  S('patient_intake', 'Patient intake', ['patient intake', 'rooming patients', 'room patients', 'patient check-in']),
  S('medical_terminology', 'Medical terminology', ['medical terminology']),
  S('hipaa', 'HIPAA', ['hipaa', 'patient confidentiality', 'phi']),
  S('injections', 'Injections', ['injections', 'administer injections', 'immunizations', 'vaccines']),
  S('patient_care', 'Patient care', ['patient care', 'direct patient care', 'bedside care', 'resident care']),
  S('adl_assistance', 'ADL assistance', ['activities of daily living', 'adls', 'adl', 'bathing', 'grooming', 'toileting', 'feeding assistance', 'personal care']),
  S('infection_control', 'Infection control', ['infection control', 'infection prevention', 'sterile technique', 'aseptic']),
  S('medication_administration', 'Medication administration', ['medication administration', 'administer medications', 'med pass', 'medication management']),
  S('care_planning', 'Care planning', ['care plans', 'care planning', 'nursing assessments', 'patient assessment']),
  S('iv_therapy', 'IV therapy', ['iv therapy', 'iv insertion', 'intravenous', 'iv starts']),
  S('diagnosis', 'Diagnosis', ['diagnose', 'diagnosis', 'differential diagnosis']),
  S('prescribing', 'Prescribing', ['prescribe', 'prescribing', 'prescriptive authority']),
  S('medication_reminders', 'Medication reminders', ['medication reminders']),
  S('meal_prep', 'Meal preparation', ['meal preparation', 'prepare meals', 'light housekeeping']),
  S('prescription_processing', 'Prescription processing', ['prescription processing', 'fill prescriptions', 'filling prescriptions', 'dispensing']),
  S('dental_procedures', 'Dental procedures', ['chairside', 'chair-side', 'dental procedures', 'four-handed dentistry']),
  S('dental_radiography', 'Dental radiography', ['dental x-rays', 'dental radiography', 'radiographs']),
  S('specimen_handling', 'Specimen handling', ['specimen collection', 'specimen handling', 'specimen processing', 'lab specimens']),
  S('insurance_verification', 'Insurance verification', ['insurance verification', 'verify insurance', 'eligibility verification', 'prior authorization']),
  S('medical_coding', 'Medical coding', ['icd-10', 'icd 10', 'cpt codes', 'cpt coding', 'medical coding', 'hcpcs']),
  S('billing', 'Billing', ['billing', 'claims processing', 'claims submission', 'accounts receivable follow']),
  // security / facilities / trades
  S('patrolling', 'Patrolling', ['patrol', 'patrols', 'patrolling', 'foot patrol', 'vehicle patrol']),
  S('surveillance', 'Surveillance', ['cctv', 'surveillance', 'monitor cameras', 'security cameras']),
  S('incident_reporting', 'Incident reporting', ['incident reports', 'incident reporting', 'daily activity reports', 'write reports']),
  S('access_control', 'Access control', ['access control', 'badge access', 'visitor management']),
  S('preventive_maintenance', 'Preventive maintenance', ['preventive maintenance', 'preventative maintenance', 'work orders', 'repairs']),
  S('hvac', 'HVAC', ['hvac', 'heating', 'air conditioning', 'ventilation', 'boilers', 'chillers']),
  S('electrical', 'Electrical', ['electrical', 'wiring', 'circuits', 'conduit', 'electrical systems']),
  S('plumbing', 'Plumbing', ['plumbing', 'pipes', 'fixtures', 'drain']),
  S('hand_tools', 'Hand tools', ['hand tools']),
  S('power_tools', 'Power tools', ['power tools']),
  S('blueprints', 'Blueprint reading', ['blueprints', 'blueprint reading', 'schematics', 'technical drawings']),
  S('nec_code', 'NEC code', ['nec', 'national electrical code']),
  S('troubleshooting_electrical', 'Electrical troubleshooting', ['electrical troubleshooting', 'troubleshoot electrical', 'multimeter']),
  S('refrigeration', 'Refrigeration', ['refrigeration', 'refrigerant']),
  S('carpentry', 'Carpentry', ['carpentry', 'framing', 'trim work', 'drywall']),
  S('site_safety', 'Site safety', ['site safety', 'jobsite safety', 'fall protection', 'osha 10', 'osha-10']),
  S('welding', 'Welding', ['welding', 'mig', 'tig', 'stick welding', 'arc welding']),
  S('fabrication', 'Fabrication', ['fabrication', 'metal fabrication', 'sheet metal']),
  S('machine_operation', 'Machine operation', ['machine operation', 'operate machinery', 'operate machines', 'cnc', 'press operation', 'production equipment']),
  S('assembly', 'Assembly', ['assembly', 'assemble products', 'assembling', 'assembly line']),
  S('quality_checks', 'Quality checks', ['quality checks', 'quality control', 'inspect products', 'inspection', 'quality inspections']),
  S('gmp', 'GMP', ['gmp', 'good manufacturing practices', 'cgmp']),
  S('lean', 'Lean / 5S', ['lean manufacturing', 'lean', '5s', 'six sigma', 'kaizen', 'continuous improvement']),
  S('measuring_tools', 'Measuring tools', ['calipers', 'micrometers', 'measuring tools', 'gauges']),
  S('iso_9001', 'ISO 9001', ['iso 9001', 'iso9001']),
  S('vehicle_diagnostics', 'Vehicle diagnostics', ['vehicle diagnostics', 'diagnostic equipment', 'obd', 'brakes', 'engine repair', 'oil changes']),
  // finance / hr / legal
  S('bookkeeping', 'Bookkeeping', ['bookkeeping', 'general ledger', 'journal entries']),
  S('quickbooks', 'QuickBooks', ['quickbooks', 'xero', 'sage accounting']),
  S('accounts_payable', 'Accounts payable', ['accounts payable', 'a/p', 'vendor payments']),
  S('accounts_receivable', 'Accounts receivable', ['accounts receivable', 'a/r', 'collections']),
  S('reconciliation', 'Reconciliation', ['reconciliation', 'reconcile', 'bank reconciliations', 'account reconciliations']),
  S('payroll', 'Payroll', ['payroll', 'adp', 'paychex', 'gusto']),
  S('gaap', 'GAAP', ['gaap', 'ifrs']),
  S('financial_reporting', 'Financial reporting', ['financial reporting', 'financial statements', 'month-end close', 'month end close']),
  S('tax', 'Tax', ['tax preparation', 'tax returns', 'tax compliance']),
  S('hris', 'HRIS', ['hris', 'workday', 'bamboohr', 'successfactors', 'ukg']),
  S('onboarding', 'Onboarding', ['onboarding', 'new hire orientation', 'orientation']),
  S('employee_relations', 'Employee relations', ['employee relations', 'investigations', 'performance management']),
  S('benefits_admin', 'Benefits administration', ['benefits administration', 'benefits enrollment', 'open enrollment']),
  S('compliance_hr', 'Employment law compliance', ['employment law', 'labor law', 'eeo', 'flsa', 'i-9']),
  S('sourcing', 'Candidate sourcing', ['sourcing', 'boolean search', 'full-cycle recruiting', 'full cycle recruiting']),
  S('ats_software', 'ATS software', ['applicant tracking', 'greenhouse', 'lever', 'icims', 'taleo']),
  S('interviewing', 'Interviewing', ['conduct interviews', 'phone screens', 'screening candidates']),
  S('legal_research', 'Legal research', ['legal research', 'westlaw', 'lexisnexis', 'lexis']),
  S('case_management', 'Case management (legal)', ['case management', 'docketing', 'calendaring deadlines', 'court filings']),
  S('legal_documents', 'Legal documents', ['legal documents', 'pleadings', 'discovery', 'draft correspondence', 'legal drafting', 'subpoenas']),
  S('e_discovery', 'E-discovery', ['e-discovery', 'ediscovery', 'relativity']),
  S('litigation', 'Litigation', ['litigation', 'trial preparation', 'depositions']),
  S('contracts', 'Contracts', ['contract drafting', 'contract review', 'contracts negotiation']),
  // education
  S('lesson_planning', 'Lesson planning', ['lesson planning', 'lesson plans', 'instruction']),
  S('classroom_management', 'Classroom management', ['classroom management', 'behavior management']),
  S('curriculum', 'Curriculum development', ['curriculum', 'curriculum development']),
  S('student_assessment', 'Student assessment', ['student assessment', 'grading', 'assessments']),
  S('student_support', 'Student support', ['student support', 'small group instruction', 'one-on-one support']),
  S('child_development', 'Child development', ['child development', 'early childhood', 'ece']),
  S('first_aid_skill', 'First aid', ['first aid']),
  // technology
  S('javascript', 'JavaScript', ['javascript', 'js', 'es6', 'ecmascript']),
  S('typescript', 'TypeScript', ['typescript', 'ts']),
  S('react', 'React', ['react', 'react.js', 'reactjs']),
  S('vue', 'Vue', ['vue', 'vue.js', 'vuejs', 'nuxt']),
  S('angular', 'Angular', ['angular', 'angularjs']),
  S('nextjs', 'Next.js', ['next.js', 'nextjs']),
  S('html', 'HTML', ['html', 'html5', 'semantic html']),
  S('css', 'CSS', ['css', 'css3', 'sass', 'scss', 'less', 'styled-components']),
  S('tailwind', 'Tailwind CSS', ['tailwind', 'tailwindcss']),
  S('redux', 'Redux', ['redux', 'zustand', 'mobx']),
  S('web_accessibility', 'Web accessibility', ['accessibility', 'wcag', 'a11y', 'aria']),
  S('responsive_design', 'Responsive design', ['responsive design', 'mobile-first', 'responsive']),
  S('git', 'Git', ['git', 'github', 'gitlab', 'version control']),
  S('rest_api', 'REST APIs', ['rest', 'restful', 'rest api', 'rest apis', 'graphql', 'api design', 'apis']),
  S('jest', 'Frontend testing', ['jest', 'vitest', 'react testing library', 'testing library']),
  S('python', 'Python', ['python', 'django', 'flask', 'fastapi']),
  S('java', 'Java', ['java', 'spring', 'spring boot']),
  S('nodejs', 'Node.js', ['node.js', 'nodejs', 'node', 'express', 'nestjs']),
  S('go', 'Go', ['golang', 'go lang', 'go programming']),
  S('csharp', 'C#/.NET', ['c#', '.net', 'dotnet', 'asp.net']),
  S('php', 'PHP', ['php', 'laravel', 'symfony']),
  S('ruby', 'Ruby', ['ruby', 'ruby on rails', 'rails']),
  S('sql', 'SQL', ['sql', 'mysql', 'sql server', 't-sql', 'relational databases']),
  S('postgresql', 'PostgreSQL', ['postgresql', 'postgres']),
  S('microservices', 'Microservices', ['microservices', 'distributed systems']),
  S('docker', 'Docker', ['docker', 'containers', 'containerization']),
  S('kubernetes', 'Kubernetes', ['kubernetes', 'k8s', 'eks', 'gke', 'aks']),
  S('aws', 'AWS', ['aws', 'amazon web services', 'ec2', 's3', 'lambda']),
  S('azure', 'Azure', ['azure', 'microsoft azure']),
  S('gcp', 'Google Cloud', ['gcp', 'google cloud']),
  S('terraform', 'Terraform', ['terraform', 'infrastructure as code', 'pulumi', 'cloudformation']),
  S('ci_cd', 'CI/CD', ['ci/cd', 'continuous integration', 'github actions', 'jenkins', 'circleci']),
  S('linux', 'Linux', ['linux', 'unix', 'bash']),
  S('monitoring', 'Monitoring', ['monitoring', 'observability', 'prometheus', 'grafana', 'datadog']),
  S('kafka', 'Kafka', ['kafka', 'rabbitmq', 'message queues']),
  S('algorithms', 'Algorithms', ['algorithms', 'data structures']),
  S('testing', 'Software testing', ['unit tests', 'unit testing', 'test-driven', 'tdd', 'integration tests', 'automated testing']),
  S('swift', 'Swift', ['swift', 'swiftui']),
  S('kotlin', 'Kotlin', ['kotlin', 'jetpack compose']),
  S('react_native', 'React Native', ['react native']),
  S('flutter', 'Flutter', ['flutter', 'dart']),
  S('ios', 'iOS', ['ios', 'xcode']),
  S('android', 'Android', ['android', 'android studio']),
  S('tableau', 'Tableau', ['tableau']),
  S('power_bi', 'Power BI', ['power bi', 'powerbi']),
  S('looker', 'Looker', ['looker', 'looker studio']),
  S('statistics', 'Statistics', ['statistics', 'statistical analysis', 'a/b testing', 'regression']),
  S('data_visualization', 'Data visualization', ['data visualization', 'dashboards', 'dashboard']),
  S('machine_learning', 'Machine learning', ['machine learning', 'ml models', 'scikit-learn', 'sklearn']),
  S('pytorch', 'PyTorch', ['pytorch']),
  S('tensorflow', 'TensorFlow', ['tensorflow', 'keras']),
  S('pandas', 'pandas', ['pandas', 'numpy']),
  S('deep_learning', 'Deep learning', ['deep learning', 'neural networks', 'llm', 'large language models']),
  S('spark', 'Spark', ['spark', 'pyspark', 'databricks']),
  S('airflow', 'Airflow', ['airflow', 'dagster', 'prefect']),
  S('dbt', 'dbt', ['dbt']),
  S('etl', 'ETL', ['etl', 'elt', 'data pipelines']),
  S('snowflake', 'Snowflake', ['snowflake', 'bigquery', 'redshift']),
  S('selenium', 'Selenium', ['selenium']),
  S('cypress', 'Cypress', ['cypress']),
  S('playwright', 'Playwright', ['playwright']),
  S('test_automation', 'Test automation', ['test automation', 'automated tests', 'automation framework']),
  S('jira', 'Jira', ['jira', 'confluence']),
  S('api_testing', 'API testing', ['api testing', 'postman']),
  S('windows', 'Windows administration', ['windows 10', 'windows 11', 'windows server', 'windows os']),
  S('active_directory', 'Active Directory', ['active directory', 'azure ad', 'entra id', 'group policy']),
  S('troubleshooting_it', 'IT troubleshooting', ['troubleshooting hardware', 'troubleshoot hardware', 'technical troubleshooting', 'troubleshoot software', 'technical support']),
  S('networking', 'Networking', ['networking', 'tcp/ip', 'dns', 'dhcp', 'vpn', 'lan', 'wan', 'firewalls']),
  S('office365', 'Microsoft 365 admin', ['office 365 administration', 'microsoft 365 admin', 'exchange online', 'intune']),
  S('hardware', 'Hardware support', ['hardware', 'printers', 'peripherals', 'imaging']),
  S('vmware', 'Virtualization', ['vmware', 'hyper-v', 'virtualization']),
  S('scripting', 'Scripting', ['powershell', 'scripting', 'shell scripting']),
  S('security_basics', 'Security fundamentals', ['security best practices', 'information security', 'cybersecurity']),
  S('siem', 'SIEM', ['siem', 'splunk', 'sentinel', 'qradar']),
  S('incident_response', 'Incident response', ['incident response', 'threat detection', 'threat hunting']),
  S('vulnerability_management', 'Vulnerability management', ['vulnerability management', 'vulnerability scanning', 'penetration testing', 'nessus']),
  S('roadmapping', 'Roadmapping', ['roadmap', 'product roadmap', 'prioritization']),
  S('user_research', 'User research', ['user research', 'customer interviews', 'usability research']),
  S('agile', 'Agile', ['agile', 'kanban', 'sprint planning']),
  S('scrum', 'Scrum', ['scrum']),
  S('analytics_product', 'Product analytics', ['product analytics', 'amplitude', 'mixpanel']),
  S('stakeholder_management', 'Stakeholder management', ['stakeholder management', 'cross-functional', 'stakeholders']),
  S('project_management', 'Project management', ['project management', 'project planning', 'project plans']),
  S('budgeting', 'Budgeting', ['budgeting', 'budgets', 'forecasting']),
  S('ms_project', 'MS Project / Asana', ['ms project', 'microsoft project', 'asana', 'monday.com', 'smartsheet']),
  S('requirements_gathering', 'Requirements gathering', ['requirements gathering', 'business requirements', 'user stories']),
  S('process_mapping', 'Process mapping', ['process mapping', 'process improvement', 'workflow analysis']),
  S('figma', 'Figma', ['figma', 'sketch', 'adobe xd']),
  S('prototyping', 'Prototyping', ['prototyping', 'prototypes']),
  S('wireframing', 'Wireframing', ['wireframes', 'wireframing']),
  S('design_systems', 'Design systems', ['design systems', 'design system', 'component library']),
  S('usability_testing', 'Usability testing', ['usability testing']),
  S('adobe_photoshop', 'Photoshop', ['photoshop']),
  S('adobe_illustrator', 'Illustrator', ['illustrator']),
  S('indesign', 'InDesign', ['indesign']),
  S('typography', 'Typography', ['typography']),
  S('branding', 'Branding', ['branding', 'brand identity', 'brand guidelines']),
  S('seo', 'SEO', ['seo', 'search engine optimization']),
  S('google_analytics', 'Google Analytics', ['google analytics', 'ga4']),
  S('social_media', 'Social media', ['social media', 'instagram', 'tiktok', 'linkedin marketing']),
  S('email_marketing', 'Email marketing', ['email marketing', 'mailchimp', 'klaviyo', 'email campaigns']),
  S('content_creation', 'Content creation', ['content creation', 'create content', 'content calendar']),
  S('paid_ads', 'Paid advertising', ['google ads', 'facebook ads', 'meta ads', 'ppc', 'paid social', 'paid search']),
  S('hubspot', 'HubSpot', ['hubspot', 'marketo', 'pardot']),
  S('copywriting', 'Copywriting', ['copywriting', 'copy writing', 'writing copy']),
  S('editing', 'Editing', ['editing', 'proofreading', 'copyediting']),
  S('technical_writing', 'Technical writing', ['technical writing', 'documentation']),
  S('prospecting', 'Prospecting', ['prospecting', 'lead generation', 'outbound']),
  S('salesforce', 'Salesforce', ['salesforce', 'sfdc']),
  S('negotiation', 'Negotiation', ['negotiation', 'negotiate', 'closing deals']),
  S('cold_calling', 'Cold calling', ['cold calling', 'cold calls', 'cold outreach']),
  S('pipeline_management', 'Pipeline management', ['pipeline management', 'sales pipeline', 'forecast accuracy']),
  S('quota_attainment', 'Quota attainment', ['quota', 'exceeded quota', 'sales targets']),
  S('account_management', 'Account management', ['account management', 'client relationships', 'renewals', 'retention']),
  S('kpi_management', 'KPI management', ['kpis', 'kpi', 'metrics', 'operational metrics'])
]

export const CERTIFICATIONS: CertificationDef[] = [
  { id: 'forklift_cert', label: 'Forklift certification', aliases: ['forklift certification', 'forklift certified', 'forklift license', 'forklift licence', 'certified forklift', 'forklift operator certification', 'powered industrial truck certification', 'staplerschein'] },
  { id: 'cdl', label: 'Commercial driver’s license (CDL)', aliases: ['cdl', 'commercial driver', 'class a license', 'class a cdl', 'class b cdl', 'cdl-a', 'cdl a', 'cdl-b', 'hgv licence', 'lgv licence'] },
  { id: 'drivers_license', label: 'Valid driver’s license', aliases: ["valid driver's license", 'valid drivers license', 'valid driver license', "driver's license", 'drivers license', 'driving licence', 'driver’s license'] },
  { id: 'food_handler', label: 'Food handler card', aliases: ['food handler card', 'food handlers card', "food handler's card", 'food handler certification', 'food handler certificate', 'servsafe', 'food safety certification', 'food manager certification'] },
  { id: 'alcohol_server', label: 'Alcohol server certification', aliases: ['tabc', 'rbs certification', 'tips certification', 'tips certified', 'responsible beverage service', 'alcohol server certification'] },
  { id: 'bls', label: 'BLS / CPR', aliases: ['bls', 'basic life support', 'cpr certification', 'cpr certified', 'cpr/first aid', 'acls'] },
  { id: 'cpr', label: 'CPR / First Aid', aliases: ['cpr', 'first aid certification', 'first aid certified', 'pediatric first aid'] },
  { id: 'cma', label: 'Medical assistant certification', aliases: ['certified medical assistant', 'cma', 'rma', 'ccma', 'medical assistant certification'] },
  { id: 'cna_cert', label: 'CNA certification', aliases: ['cna certification', 'cna license', 'certified nursing assistant', 'active cna', 'state certified nursing assistant'] },
  { id: 'rn_license', label: 'RN license', aliases: ['rn license', 'registered nurse license', 'active rn', 'current rn', 'licensed as a registered nurse', 'rn licensure', 'compact license'] },
  { id: 'lpn_license', label: 'LPN/LVN license', aliases: ['lpn license', 'lvn license', 'licensed practical nurse', 'licensed vocational nurse'] },
  { id: 'np_license', label: 'NP license', aliases: ['np license', 'nurse practitioner license', 'aprn', 'dea license'] },
  { id: 'hha_cert', label: 'Home health aide certification', aliases: ['hha certification', 'home health aide certification', 'hha certificate', 'pca certification'] },
  { id: 'ptcb', label: 'Pharmacy technician certification', aliases: ['ptcb', 'cpht', 'pharmacy technician license', 'pharmacy technician certification', 'excpt'] },
  { id: 'phlebotomy_cert', label: 'Phlebotomy certification', aliases: ['phlebotomy certification', 'cpt-1', 'certified phlebotomy technician', 'phlebotomy license'] },
  { id: 'guard_card', label: 'Security guard license', aliases: ['guard card', 'bsis', 'security guard license', 'security license', 'sia licence', 'guard license', 'security officer license'] },
  { id: 'electrician_license', label: 'Electrician license', aliases: ['electrician license', 'journeyman license', 'electrical license', 'master electrician license'] },
  { id: 'epa_608', label: 'EPA 608 certification', aliases: ['epa 608', 'epa certification', 'epa universal'] },
  { id: 'osha_10', label: 'OSHA 10/30', aliases: ['osha 10', 'osha-10', 'osha 30', 'osha-30'] },
  { id: 'welding_cert', label: 'Welding certification', aliases: ['aws certified welder', 'welding certification', 'certified welder'] },
  { id: 'ase', label: 'ASE certification', aliases: ['ase certification', 'ase certified'] },
  { id: 'cpa', label: 'CPA', aliases: ['cpa', 'certified public accountant', 'chartered accountant', 'acca'] },
  { id: 'bar_admission', label: 'Bar admission', aliases: ['admitted to the bar', 'bar admission', 'member of the bar', 'licensed to practice law', 'active bar'] },
  { id: 'teaching_credential', label: 'Teaching credential', aliases: ['teaching credential', 'teaching license', 'teaching certificate', 'state teaching certification', 'qts'] },
  { id: 'comptia_a', label: 'CompTIA A+', aliases: ['comptia a+', 'a+ certification', 'a+ certified'] },
  { id: 'pmp', label: 'PMP', aliases: ['pmp', 'project management professional', 'capm'] },
  { id: 'security_clearance', label: 'Security clearance', aliases: ['security clearance', 'secret clearance', 'top secret', 'ts/sci', 'public trust clearance'] }
]

export const SKILL_BY_ID = new Map(SKILLS.map((s) => [s.id, s]))
export const CERT_BY_ID = new Map(CERTIFICATIONS.map((c) => [c.id, c]))

// ---------------------------------------------------------------------------
// Phrase matching
// ---------------------------------------------------------------------------

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Aliases that are too short/ambiguous for free text unless they appear in a skills list. */
const AMBIGUOUS_ALIASES = new Set(['js', 'ts', 'go', 'node', 'rest', 'lean', 'mig', 'tig', 'nec', 'bol', 'pos', 'register', 'till', 'displays', 'shipping', 'receiving', 'packing', 'loading', 'cleaning', 'accuracy', 'responsive', 'spring', 'express', 'sap', 'erp', 'cma', 'rma', 'bls', 'cdl', 'cpr', 'cpa', 'pmp', 'phi', 'dns', 'lan', 'wan', 'ece', 'a/p', 'a/r', 'apis', 'hardware', 'metrics', 'kpi', 'kpis', 'eld', 'tips certified', 'dolly', 'dart', 'sketch', 'lever', 'greenhouse', 'sentinel', 'imaging', 'booking', 'bookings', 'orientation', 'instruction', 'grading', 'assessments', 'drain', 'pipes', 'fixtures', 'heating', 'wiring', 'circuits', 'documentation', 'dashboards', 'dashboard', 'regression', 'retention', 'renewals', 'outbound', 'displays', 'navigation', 'gps', 'grill', 'vitals', 'epic', 'mobx', 'less', 'aria', 'vue', 'sre'])

/** Uppercase forms that are too ambiguous even as acronyms. */
const UPPERCASE_UNSAFE = new Set(['go', 'ts', 'less', 'till', 'dart', 'node', 'dns', 'lan', 'wan', 'phi'])

interface CompiledAlias {
  id: string
  alias: string
  re: RegExp
  ambiguous: boolean
}

function compile(defs: { id: string; aliases: string[] }[]): CompiledAlias[] {
  const out: CompiledAlias[] = []
  for (const d of defs) {
    for (const a of d.aliases) {
      const alias = a.toLowerCase()
      // "collaborat" is a deliberate stem; everything else is a whole phrase.
      const tail = alias === 'collaborat' ? '' : '(?![a-z0-9+#])'
      out.push({ id: d.id, alias, re: new RegExp(`(?<![a-z0-9])${escapeRe(alias)}${tail}`, 'i'), ambiguous: AMBIGUOUS_ALIASES.has(alias) })
    }
  }
  return out
}

const SKILL_ALIASES = compile(SKILLS)
const CERT_ALIASES = compile(CERTIFICATIONS)

/**
 * Finds skill ids mentioned in text. Ambiguous short aliases (e.g. "go",
 * "pos", "lean") only count when `strict` is false, i.e. inside an explicit
 * skills list or tag set.
 */
export function findSkills(text: string, opts: { strict?: boolean } = {}): string[] {
  const strict = opts.strict ?? true
  const found = new Set<string>()
  const lower = text.toLowerCase()
  for (const a of SKILL_ALIASES) {
    if (found.has(a.id)) continue
    if (strict && a.ambiguous) {
      // Short acronyms ("POS", "SAP", "REST", "MIG") count when written in uppercase in the source.
      if (/^[a-z]{2,4}$/.test(a.alias) && !UPPERCASE_UNSAFE.has(a.alias) && new RegExp(`(?<![A-Za-z0-9])${a.alias.toUpperCase()}(?![A-Za-z0-9])`).test(text)) found.add(a.id)
      continue
    }
    if (a.re.test(lower)) found.add(a.id)
  }
  // Context-dependent short aliases that are safe with a qualifier nearby.
  if (strict) {
    if (/\b(pos|point of sale) (system|systems|terminal)s?\b/i.test(lower)) found.add('pos')
    if (/\bcash register\b/i.test(lower)) found.add('pos')
    if (/\b(golang|go \(golang\)|in go\b|go,)/i.test(lower)) found.add('go')
    if (/\bnode(\.js|js)?\b.{0,20}\b(backend|server|express|api)/i.test(lower)) found.add('nodejs')
    if (/\b(shipping|receiving) (department|dock|clerk|area|duties|and receiving)/i.test(lower)) found.add('shipping_receiving')
    if (/\b(loading|unloading) (trucks|trailers|containers|freight|docks?)\b/i.test(lower)) found.add('loading')
    if (/\bpack(ing)? (orders|boxes|products|shipments)\b/i.test(lower)) found.add('packing')
    if (/\b(lean|six sigma|5s) (manufacturing|principles|methodolog)/i.test(lower)) found.add('lean')
  }
  return [...found]
}

export function findCertifications(text: string, opts: { strict?: boolean } = {}): string[] {
  const strict = opts.strict ?? true
  const found = new Set<string>()
  const lower = text.toLowerCase()
  for (const a of CERT_ALIASES) {
    if (found.has(a.id)) continue
    if (strict && a.ambiguous) {
      // Short credential acronyms ("CDL", "BLS", "CPR") count when written in uppercase in the source.
      if (/^[a-z]{2,4}$/.test(a.alias) && new RegExp(`(?<![A-Za-z0-9])${a.alias.toUpperCase()}(?![A-Za-z0-9])`).test(text)) found.add(a.id)
      continue
    }
    if (a.re.test(lower)) found.add(a.id)
  }
  return [...found]
}

export function skillLabel(id: string): string {
  return SKILL_BY_ID.get(id)?.label ?? CERT_BY_ID.get(id)?.label ?? id
}

export function isTransferable(id: string): boolean {
  return !!SKILL_BY_ID.get(id)?.transferable
}

/** Maps a free-form resume skill ("Espresso Machines & Coffee Brewing") onto dictionary ids. */
export function canonicalizeSkill(name: string): string[] {
  return findSkills(name, { strict: false })
}
