/**
 * Occupational taxonomy used for query interpretation, job classification and
 * match relevance.
 *
 * Each occupation lists title phrases that identify it (primary signal), the
 * occupation-specific skills that matter for it, and a short list of genuinely
 * related occupations (partial relevance). Broad transferable skills such as
 * "customer service" are deliberately NOT occupation evidence: a paralegal role
 * must never look like a warehouse role because both mention customers.
 *
 * Title phrases include common non-English variants for international boards.
 */
export interface Occupation {
  id: string
  label: string
  family: string
  titles: string[]
  /** Specific skill ids (see skills.ts) that indicate qualification for this occupation. */
  skills: string[]
  related: string[]
  /** Certifications commonly required; only enforced when a posting states them. */
  certifications?: string[]
  /** Extra single words that, alone in a search query, mean this occupation. */
  queryWords?: string[]
}

export const OCCUPATIONS: Occupation[] = [
  // ---------------------------------------------------------------- warehouse / logistics
  {
    id: 'warehouse_associate',
    label: 'Warehouse Associate',
    family: 'warehouse',
    titles: [
      'warehouse associate',
      'warehouse worker',
      'material handler',
      'order picker',
      'fulfillment associate',
      'distribution associate',
      'warehouse team member',
      'warehouse operative',
      'warehouse clerk',
      'warehouse assistant',
      'warehouse operator',
      'warehouse specialist',
      'warehouse handler',
      'warehouse',
      'fulfilment associate',
      'warehouse operations associate',
      'warehouse operations worker',
      'warehouse operations team member',
      'fulfillment center associate',
      'fulfillment specialist',
      'distribution center associate',
      'distribution worker',
      'materials handler',
      'picker packer',
      'picker',
      'packer',
      'order selector',
      'order filler',
      'package handler',
      'loader',
      'unloader',
      'dock worker',
      'dock associate',
      'freight handler',
      'inventory associate',
      'lagermitarbeiter',
      'lagerhelfer',
      'lagerist',
      'magasinier',
      'preparateur de commandes',
      'mozo de almacen',
      'magazijnmedewerker'
    ],
    skills: [
      'inventory',
      'forklift',
      'pallet_jack',
      'rf_scanner',
      'shipping_receiving',
      'order_picking',
      'packing',
      'loading',
      'stocking',
      'wms',
      'cycle_counting',
      'heavy_lifting',
      'warehouse_safety'
    ],
    related: [
      'forklift_operator',
      'shipping_receiving_clerk',
      'inventory_specialist',
      'warehouse_supervisor',
      'stock_associate',
      'delivery_driver',
      'production_worker'
    ],
    certifications: ['forklift_cert'],
    queryWords: ['warehouse', 'fulfillment', 'fulfilment', 'picking', 'packing']
  },
  {
    id: 'forklift_operator',
    label: 'Forklift Operator',
    family: 'warehouse',
    titles: [
      'forklift operator',
      'forklift driver',
      'reach truck operator',
      'lift truck operator',
      'forklift',
      'staplerfahrer',
      'cariste'
    ],
    skills: [
      'forklift',
      'pallet_jack',
      'loading',
      'warehouse_safety',
      'inventory',
      'shipping_receiving'
    ],
    related: ['warehouse_associate', 'shipping_receiving_clerk'],
    certifications: ['forklift_cert']
  },
  {
    id: 'shipping_receiving_clerk',
    label: 'Shipping & Receiving Clerk',
    family: 'warehouse',
    titles: [
      'shipping clerk',
      'receiving clerk',
      'shipping and receiving',
      'shipping receiving',
      'shipping associate',
      'receiving associate',
      'dock clerk',
      'receiver',
      'shipper'
    ],
    skills: [
      'shipping_receiving',
      'inventory',
      'rf_scanner',
      'data_entry',
      'wms',
      'loading',
      'forklift'
    ],
    related: [
      'warehouse_associate',
      'inventory_specialist',
      'forklift_operator',
      'logistics_coordinator'
    ]
  },
  {
    id: 'inventory_specialist',
    label: 'Inventory Specialist',
    family: 'warehouse',
    titles: [
      'inventory specialist',
      'inventory control',
      'inventory coordinator',
      'inventory clerk',
      'inventory control specialist',
      'stock controller',
      'inventory lead'
    ],
    skills: ['inventory', 'cycle_counting', 'wms', 'data_entry', 'excel', 'shipping_receiving'],
    related: [
      'warehouse_associate',
      'shipping_receiving_clerk',
      'logistics_coordinator',
      'stock_associate'
    ]
  },
  {
    id: 'warehouse_supervisor',
    label: 'Warehouse Supervisor',
    family: 'warehouse',
    titles: [
      'warehouse supervisor',
      'warehouse lead',
      'warehouse manager',
      'distribution supervisor',
      'distribution manager',
      'fulfillment supervisor',
      'warehouse team lead',
      'lagerleiter'
    ],
    skills: [
      'inventory',
      'wms',
      'team_leadership',
      'scheduling',
      'warehouse_safety',
      'shipping_receiving',
      'forklift'
    ],
    related: [
      'warehouse_associate',
      'logistics_coordinator',
      'operations_manager',
      'inventory_specialist'
    ]
  },
  {
    id: 'logistics_coordinator',
    label: 'Logistics Coordinator',
    family: 'warehouse',
    titles: [
      'logistics coordinator',
      'logistics specialist',
      'logistics associate',
      'supply chain coordinator',
      'supply chain specialist',
      'logistics analyst',
      'transportation coordinator',
      'dispatcher',
      'dispatch coordinator',
      'freight coordinator'
    ],
    skills: [
      'logistics',
      'shipping_receiving',
      'inventory',
      'excel',
      'erp',
      'scheduling',
      'dispatching'
    ],
    related: [
      'warehouse_supervisor',
      'shipping_receiving_clerk',
      'inventory_specialist',
      'operations_coordinator'
    ]
  },
  {
    id: 'delivery_driver',
    label: 'Delivery Driver',
    family: 'transportation',
    titles: [
      'delivery driver',
      'courier',
      'driver helper',
      'route driver',
      'van driver',
      'delivery associate',
      'delivery specialist',
      'package delivery',
      'route sales driver',
      'auslieferungsfahrer'
    ],
    skills: ['driving', 'route_planning', 'loading', 'customer_delivery'],
    related: ['truck_driver', 'warehouse_associate'],
    certifications: ['drivers_license'],
    queryWords: ['delivery', 'courier']
  },
  {
    id: 'truck_driver',
    label: 'Truck Driver (CDL)',
    family: 'transportation',
    titles: [
      'truck driver',
      'cdl driver',
      'class a driver',
      'class b driver',
      'cdl a driver',
      'tractor trailer driver',
      'otr driver',
      'regional driver',
      'local cdl driver',
      'lorry driver',
      'hgv driver',
      'lkw fahrer',
      'berufskraftfahrer'
    ],
    skills: ['driving', 'route_planning', 'dot_compliance', 'loading'],
    related: ['delivery_driver'],
    certifications: ['cdl'],
    queryWords: ['trucking', 'cdl']
  },
  // ---------------------------------------------------------------- food service
  {
    id: 'barista',
    label: 'Barista',
    family: 'food_service',
    titles: [
      'barista',
      'coffee specialist',
      'coffee shop associate',
      'espresso bar attendant',
      'coffee bar attendant',
      'cafe associate',
      'café associate',
      'cafe attendant',
      'café attendant',
      'coffee barista',
      'lead barista',
      'head barista',
      'barista trainer',
      'coffee maker',
      'coffee master'
    ],
    skills: [
      'espresso',
      'milk_steaming',
      'latte_art',
      'coffee_brewing',
      'beverage_prep',
      'pos',
      'cash_handling',
      'food_safety',
      'opening_closing'
    ],
    related: [
      'food_service_worker',
      'shift_supervisor',
      'cashier',
      'server',
      'bartender',
      'cafe_manager'
    ],
    certifications: ['food_handler'],
    queryWords: ['coffee', 'espresso', 'cafe', 'café']
  },
  {
    id: 'food_service_worker',
    label: 'Food Service Worker',
    family: 'food_service',
    titles: [
      'food service worker',
      'food service associate',
      'crew member',
      'restaurant crew',
      'team member restaurant',
      'counter attendant',
      'food runner',
      'busser',
      'bus person',
      'fast food',
      'food prep',
      'food preparation',
      'concession worker',
      'deli clerk',
      'bakery clerk',
      'sandwich artist',
      'kitchen helper'
    ],
    skills: [
      'food_safety',
      'food_prep',
      'pos',
      'cash_handling',
      'beverage_prep',
      'opening_closing'
    ],
    related: ['barista', 'cook', 'server', 'cashier', 'dishwasher', 'shift_supervisor'],
    certifications: ['food_handler'],
    queryWords: ['restaurant']
  },
  {
    id: 'cook',
    label: 'Cook',
    family: 'food_service',
    titles: [
      'line cook',
      'prep cook',
      'cook',
      'short order cook',
      'grill cook',
      'kitchen assistant',
      'commis chef',
      'chef de partie',
      'sous chef',
      'chef',
      'kitchen team member',
      'breakfast cook',
      'koch',
      'cuisinier',
      'cocinero'
    ],
    skills: ['food_prep', 'food_safety', 'knife_skills', 'cooking', 'kitchen_equipment'],
    related: ['food_service_worker', 'dishwasher', 'restaurant_manager'],
    certifications: ['food_handler'],
    queryWords: ['kitchen', 'culinary']
  },
  {
    id: 'dishwasher',
    label: 'Dishwasher',
    family: 'food_service',
    titles: [
      'dishwasher',
      'kitchen porter',
      'dish washer',
      'utility worker kitchen',
      'kitchen steward',
      'pot washer'
    ],
    skills: ['food_safety', 'sanitation', 'kitchen_equipment'],
    related: ['cook', 'food_service_worker', 'janitor']
  },
  {
    id: 'server',
    label: 'Server',
    family: 'food_service',
    titles: [
      'server',
      'waiter',
      'waitress',
      'waitstaff',
      'food server',
      'banquet server',
      'cocktail server',
      'host',
      'hostess',
      'restaurant host',
      'kellner',
      'serveur',
      'camarero'
    ],
    skills: ['table_service', 'pos', 'cash_handling', 'food_safety', 'upselling', 'menu_knowledge'],
    related: ['bartender', 'food_service_worker', 'barista'],
    certifications: ['food_handler', 'alcohol_server']
  },
  {
    id: 'bartender',
    label: 'Bartender',
    family: 'food_service',
    titles: ['bartender', 'barback', 'mixologist', 'bar staff', 'barkeeper'],
    skills: ['mixology', 'beverage_prep', 'pos', 'cash_handling', 'alcohol_compliance'],
    related: ['server', 'barista'],
    certifications: ['alcohol_server']
  },
  {
    id: 'shift_supervisor',
    label: 'Shift Supervisor (Food/Retail)',
    family: 'food_service',
    titles: [
      'shift supervisor',
      'shift lead',
      'shift leader',
      'shift manager',
      'crew leader',
      'crew trainer',
      'team lead store',
      'keyholder',
      'key holder'
    ],
    skills: [
      'team_leadership',
      'cash_handling',
      'pos',
      'opening_closing',
      'scheduling',
      'food_safety',
      'inventory'
    ],
    related: [
      'barista',
      'food_service_worker',
      'retail_associate',
      'cashier',
      'cafe_manager',
      'store_manager',
      'restaurant_manager'
    ]
  },
  {
    id: 'cafe_manager',
    label: 'Café / Coffee Shop Manager',
    family: 'food_service',
    titles: [
      'cafe manager',
      'café manager',
      'coffee shop manager',
      'coffee house manager',
      'assistant cafe manager'
    ],
    skills: [
      'team_leadership',
      'scheduling',
      'inventory',
      'espresso',
      'food_safety',
      'cash_handling',
      'pnl'
    ],
    related: ['barista', 'shift_supervisor', 'restaurant_manager']
  },
  {
    id: 'restaurant_manager',
    label: 'Restaurant Manager',
    family: 'food_service',
    titles: [
      'restaurant manager',
      'restaurant general manager',
      'assistant restaurant manager',
      'kitchen manager',
      'food service manager',
      'food and beverage manager',
      'f&b manager'
    ],
    skills: ['team_leadership', 'scheduling', 'inventory', 'food_safety', 'pnl', 'hiring'],
    related: ['shift_supervisor', 'cafe_manager', 'cook']
  },
  // ---------------------------------------------------------------- retail
  {
    id: 'retail_associate',
    label: 'Retail Sales Associate',
    family: 'retail',
    titles: [
      'retail associate',
      'sales associate',
      'retail sales associate',
      'store associate',
      'retail team member',
      'shop assistant',
      'retail assistant',
      'sales floor associate',
      'retail sales',
      'store team member',
      'sales clerk',
      'retail clerk',
      'verkaufer',
      'vendeur',
      'dependiente'
    ],
    skills: [
      'pos',
      'cash_handling',
      'merchandising',
      'stocking',
      'upselling',
      'inventory',
      'opening_closing'
    ],
    related: ['cashier', 'stock_associate', 'merchandiser', 'shift_supervisor', 'store_manager'],
    queryWords: ['retail']
  },
  {
    id: 'cashier',
    label: 'Cashier',
    family: 'retail',
    titles: [
      'cashier',
      'checker',
      'front end associate',
      'checkout operator',
      'till operator',
      'cashier associate',
      'front end cashier',
      'kassierer'
    ],
    skills: ['pos', 'cash_handling', 'upselling'],
    related: ['retail_associate', 'barista', 'food_service_worker', 'stock_associate']
  },
  {
    id: 'stock_associate',
    label: 'Stock Associate',
    family: 'retail',
    titles: [
      'stock associate',
      'stocker',
      'stock clerk',
      'overnight stocker',
      'shelf stocker',
      'replenishment associate',
      'merchandise associate',
      'retail stocker',
      'stock team member',
      'grocery stocker',
      'inventory stocker'
    ],
    skills: [
      'stocking',
      'inventory',
      'merchandising',
      'heavy_lifting',
      'pallet_jack',
      'rf_scanner'
    ],
    related: ['retail_associate', 'warehouse_associate', 'cashier', 'merchandiser']
  },
  {
    id: 'merchandiser',
    label: 'Merchandiser',
    family: 'retail',
    titles: [
      'merchandiser',
      'visual merchandiser',
      'merchandising associate',
      'retail merchandiser',
      'field merchandiser'
    ],
    skills: ['merchandising', 'stocking', 'inventory', 'planograms'],
    related: ['stock_associate', 'retail_associate']
  },
  {
    id: 'store_manager',
    label: 'Store Manager',
    family: 'retail',
    titles: [
      'store manager',
      'assistant store manager',
      'retail manager',
      'department manager',
      'store supervisor',
      'assistant manager retail',
      'filialleiter'
    ],
    skills: [
      'team_leadership',
      'scheduling',
      'inventory',
      'merchandising',
      'pnl',
      'hiring',
      'cash_handling'
    ],
    related: ['shift_supervisor', 'retail_associate', 'operations_manager']
  },
  // ---------------------------------------------------------------- hospitality
  {
    id: 'front_desk_agent',
    label: 'Hotel Front Desk Agent',
    family: 'hospitality',
    titles: [
      'front desk agent',
      'front desk associate',
      'guest service agent',
      'guest services agent',
      'guest service representative',
      'hotel receptionist',
      'front desk clerk',
      'night auditor',
      'front office agent',
      'concierge',
      'hotel front desk',
      'front desk supervisor',
      'rezeptionist'
    ],
    skills: ['hotel_pms', 'reservations', 'cash_handling', 'check_in', 'guest_relations'],
    related: ['receptionist', 'housekeeper', 'customer_service_rep'],
    queryWords: ['hotel']
  },
  {
    id: 'housekeeper',
    label: 'Housekeeper',
    family: 'hospitality',
    titles: [
      'housekeeper',
      'room attendant',
      'housekeeping attendant',
      'housekeeping associate',
      'house person',
      'houseperson',
      'laundry attendant',
      'zimmermadchen'
    ],
    skills: ['cleaning', 'sanitation', 'laundry'],
    related: ['janitor', 'front_desk_agent'],
    queryWords: ['housekeeping']
  },
  // ---------------------------------------------------------------- office / admin / customer service
  {
    id: 'receptionist',
    label: 'Receptionist',
    family: 'admin',
    titles: [
      'receptionist',
      'front desk receptionist',
      'office receptionist',
      'front desk coordinator',
      'reception'
    ],
    skills: ['phone_etiquette', 'scheduling', 'data_entry', 'ms_office', 'filing'],
    related: [
      'administrative_assistant',
      'front_desk_agent',
      'medical_receptionist',
      'customer_service_rep'
    ]
  },
  {
    id: 'administrative_assistant',
    label: 'Administrative Assistant',
    family: 'admin',
    titles: [
      'administrative assistant',
      'admin assistant',
      'office assistant',
      'executive assistant',
      'administrative coordinator',
      'office coordinator',
      'secretary',
      'clerical assistant',
      'administrative associate',
      'administrative specialist',
      'personal assistant',
      'office clerk',
      'general office clerk',
      'burokaufmann',
      'assistente amministrativo'
    ],
    skills: [
      'ms_office',
      'scheduling',
      'data_entry',
      'filing',
      'calendar_management',
      'excel',
      'phone_etiquette',
      'bookkeeping_basic'
    ],
    related: [
      'receptionist',
      'office_manager',
      'data_entry_clerk',
      'operations_coordinator',
      'hr_generalist'
    ],
    queryWords: ['administrative', 'admin', 'clerical']
  },
  {
    id: 'office_manager',
    label: 'Office Manager',
    family: 'admin',
    titles: [
      'office manager',
      'office administrator',
      'office operations manager',
      'administrative manager',
      'office lead'
    ],
    skills: [
      'ms_office',
      'scheduling',
      'bookkeeping_basic',
      'vendor_management',
      'team_leadership',
      'calendar_management',
      'excel'
    ],
    related: ['administrative_assistant', 'operations_coordinator', 'operations_manager']
  },
  {
    id: 'data_entry_clerk',
    label: 'Data Entry Clerk',
    family: 'admin',
    titles: [
      'data entry clerk',
      'data entry specialist',
      'data entry operator',
      'data entry',
      'records clerk',
      'file clerk',
      'document control clerk'
    ],
    skills: ['data_entry', 'typing', 'excel', 'ms_office', 'filing'],
    related: ['administrative_assistant', 'receptionist']
  },
  {
    id: 'operations_coordinator',
    label: 'Operations Coordinator',
    family: 'admin',
    titles: [
      'operations coordinator',
      'operations assistant',
      'operations associate',
      'operations specialist',
      'operations administrator',
      'program coordinator'
    ],
    skills: [
      'scheduling',
      'excel',
      'ms_office',
      'logistics',
      'vendor_management',
      'data_entry',
      'erp'
    ],
    related: [
      'administrative_assistant',
      'office_manager',
      'logistics_coordinator',
      'operations_manager',
      'project_manager'
    ]
  },
  {
    id: 'customer_service_rep',
    label: 'Customer Service Representative',
    family: 'customer_service',
    titles: [
      'customer service representative',
      'customer service agent',
      'customer support representative',
      'customer support agent',
      'call center representative',
      'call center agent',
      'customer care representative',
      'client service representative',
      'contact center agent',
      'customer service specialist',
      'customer service associate',
      'support specialist',
      'kundenberater',
      'kundenservice'
    ],
    skills: ['crm', 'phone_etiquette', 'ticketing', 'data_entry', 'conflict_resolution'],
    related: ['receptionist', 'customer_success', 'sales_representative', 'front_desk_agent'],
    queryWords: ['call center', 'customer support']
  },
  // ---------------------------------------------------------------- healthcare
  {
    id: 'medical_assistant',
    label: 'Medical Assistant',
    family: 'healthcare',
    titles: [
      'medical assistant',
      'clinical assistant',
      'certified medical assistant',
      'ma clinical',
      'back office medical assistant'
    ],
    skills: [
      'vital_signs',
      'ehr',
      'phlebotomy',
      'patient_intake',
      'medical_terminology',
      'hipaa',
      'injections'
    ],
    related: ['cna', 'medical_receptionist', 'phlebotomist', 'lpn'],
    certifications: ['cma', 'bls']
  },
  {
    id: 'cna',
    label: 'Certified Nursing Assistant',
    family: 'healthcare',
    titles: [
      'certified nursing assistant',
      'cna',
      'nursing assistant',
      'nurse aide',
      'nursing aide',
      'patient care technician',
      'patient care assistant',
      'care assistant nursing',
      'stna',
      'healthcare assistant'
    ],
    skills: [
      'patient_care',
      'vital_signs',
      'adl_assistance',
      'infection_control',
      'ehr',
      'medical_terminology'
    ],
    related: ['caregiver', 'lpn', 'medical_assistant', 'registered_nurse'],
    certifications: ['cna_cert', 'bls']
  },
  {
    id: 'registered_nurse',
    label: 'Registered Nurse',
    family: 'healthcare',
    titles: [
      'registered nurse',
      'rn',
      'staff nurse',
      'charge nurse',
      'nurse',
      'icu nurse',
      'er nurse',
      'travel nurse',
      'nurse clinician',
      'krankenschwester',
      'pflegefachkraft',
      'infirmier',
      'infirmiere'
    ],
    skills: [
      'patient_care',
      'medication_administration',
      'ehr',
      'vital_signs',
      'care_planning',
      'infection_control',
      'iv_therapy'
    ],
    related: ['lpn', 'cna', 'nurse_practitioner'],
    certifications: ['rn_license', 'bls'],
    queryWords: ['nursing']
  },
  {
    id: 'lpn',
    label: 'Licensed Practical/Vocational Nurse',
    family: 'healthcare',
    titles: ['licensed practical nurse', 'licensed vocational nurse', 'lpn', 'lvn'],
    skills: [
      'patient_care',
      'medication_administration',
      'vital_signs',
      'ehr',
      'infection_control'
    ],
    related: ['registered_nurse', 'cna', 'medical_assistant'],
    certifications: ['lpn_license', 'bls']
  },
  {
    id: 'nurse_practitioner',
    label: 'Nurse Practitioner',
    family: 'healthcare',
    titles: ['nurse practitioner', 'np', 'family nurse practitioner', 'fnp', 'physician assistant'],
    skills: ['patient_care', 'diagnosis', 'prescribing', 'ehr', 'care_planning'],
    related: ['registered_nurse'],
    certifications: ['np_license']
  },
  {
    id: 'caregiver',
    label: 'Caregiver / Home Health Aide',
    family: 'healthcare',
    titles: [
      'caregiver',
      'home health aide',
      'personal care aide',
      'direct support professional',
      'care assistant',
      'support worker',
      'home care aide',
      'personal support worker',
      'care worker',
      'companion caregiver',
      'altenpfleger'
    ],
    skills: [
      'adl_assistance',
      'patient_care',
      'medication_reminders',
      'meal_prep',
      'infection_control'
    ],
    related: ['cna'],
    certifications: ['hha_cert', 'bls']
  },
  {
    id: 'pharmacy_technician',
    label: 'Pharmacy Technician',
    family: 'healthcare',
    titles: [
      'pharmacy technician',
      'pharmacy tech',
      'pharmacy assistant',
      'certified pharmacy technician'
    ],
    skills: ['prescription_processing', 'medical_terminology', 'pos', 'inventory', 'hipaa'],
    related: ['medical_assistant'],
    certifications: ['ptcb']
  },
  {
    id: 'dental_assistant',
    label: 'Dental Assistant',
    family: 'healthcare',
    titles: [
      'dental assistant',
      'registered dental assistant',
      'dental nurse',
      'orthodontic assistant'
    ],
    skills: ['dental_procedures', 'infection_control', 'dental_radiography', 'patient_intake'],
    related: ['medical_assistant']
  },
  {
    id: 'phlebotomist',
    label: 'Phlebotomist',
    family: 'healthcare',
    titles: ['phlebotomist', 'phlebotomy technician', 'lab assistant', 'specimen processor'],
    skills: ['phlebotomy', 'specimen_handling', 'infection_control', 'patient_intake'],
    related: ['medical_assistant'],
    certifications: ['phlebotomy_cert']
  },
  {
    id: 'medical_receptionist',
    label: 'Medical Receptionist / Patient Access',
    family: 'healthcare',
    titles: [
      'medical receptionist',
      'patient access representative',
      'patient service representative',
      'medical office assistant',
      'front office medical',
      'patient coordinator',
      'medical front desk',
      'unit secretary',
      'medical secretary'
    ],
    skills: [
      'ehr',
      'scheduling',
      'insurance_verification',
      'hipaa',
      'medical_terminology',
      'data_entry'
    ],
    related: ['receptionist', 'medical_assistant', 'medical_billing', 'administrative_assistant']
  },
  {
    id: 'medical_billing',
    label: 'Medical Biller / Coder',
    family: 'healthcare',
    titles: [
      'medical biller',
      'medical coder',
      'medical billing specialist',
      'billing specialist medical',
      'coding specialist',
      'revenue cycle specialist'
    ],
    skills: ['medical_coding', 'insurance_verification', 'ehr', 'hipaa', 'billing'],
    related: ['medical_receptionist', 'bookkeeper']
  },
  // ---------------------------------------------------------------- security / facilities / trades
  {
    id: 'security_guard',
    label: 'Security Officer',
    family: 'security',
    titles: [
      'security guard',
      'security officer',
      'security agent',
      'loss prevention officer',
      'loss prevention associate',
      'patrol officer security',
      'unarmed security',
      'armed security',
      'sicherheitsmitarbeiter',
      'agent de securite'
    ],
    skills: ['patrolling', 'surveillance', 'incident_reporting', 'access_control'],
    related: ['janitor'],
    certifications: ['guard_card'],
    queryWords: ['security']
  },
  {
    id: 'janitor',
    label: 'Janitor / Custodian',
    family: 'facilities',
    titles: [
      'janitor',
      'custodian',
      'cleaner',
      'cleaning technician',
      'janitorial',
      'porter',
      'custodial worker',
      'commercial cleaner',
      'reinigungskraft'
    ],
    skills: ['cleaning', 'sanitation', 'floor_care'],
    related: ['housekeeper', 'maintenance_technician', 'dishwasher'],
    queryWords: ['cleaning']
  },
  {
    id: 'maintenance_technician',
    label: 'Maintenance Technician',
    family: 'facilities',
    titles: [
      'maintenance technician',
      'maintenance worker',
      'facilities technician',
      'building maintenance',
      'handyman',
      'maintenance mechanic',
      'building engineer',
      'maintenance tech',
      'facilities maintenance'
    ],
    skills: [
      'preventive_maintenance',
      'hvac',
      'electrical',
      'plumbing',
      'hand_tools',
      'power_tools'
    ],
    related: ['hvac_technician', 'electrician', 'janitor', 'production_worker'],
    queryWords: ['maintenance']
  },
  {
    id: 'electrician',
    label: 'Electrician',
    family: 'trades',
    titles: [
      'electrician',
      'journeyman electrician',
      'apprentice electrician',
      'electrical technician',
      'master electrician',
      'elektriker',
      'electricien'
    ],
    skills: ['electrical', 'blueprints', 'nec_code', 'power_tools', 'troubleshooting_electrical'],
    related: ['maintenance_technician', 'hvac_technician'],
    certifications: ['electrician_license']
  },
  {
    id: 'hvac_technician',
    label: 'HVAC Technician',
    family: 'trades',
    titles: [
      'hvac technician',
      'hvac tech',
      'hvac installer',
      'refrigeration technician',
      'hvac mechanic'
    ],
    skills: ['hvac', 'refrigeration', 'electrical', 'troubleshooting_electrical'],
    related: ['maintenance_technician', 'electrician'],
    certifications: ['epa_608']
  },
  {
    id: 'plumber',
    label: 'Plumber',
    family: 'trades',
    titles: ['plumber', 'apprentice plumber', 'journeyman plumber', 'pipefitter', 'klempner'],
    skills: ['plumbing', 'blueprints', 'hand_tools', 'power_tools'],
    related: ['maintenance_technician']
  },
  {
    id: 'carpenter',
    label: 'Carpenter',
    family: 'trades',
    titles: [
      'carpenter',
      'finish carpenter',
      'framer',
      'cabinet maker',
      'woodworker',
      'tischler',
      'schreiner'
    ],
    skills: ['carpentry', 'blueprints', 'power_tools', 'hand_tools'],
    related: ['construction_laborer']
  },
  {
    id: 'construction_laborer',
    label: 'Construction Laborer',
    family: 'trades',
    titles: [
      'construction laborer',
      'general laborer',
      'construction worker',
      'laborer',
      'labourer',
      'construction helper',
      'site laborer',
      'bauhelfer'
    ],
    skills: ['power_tools', 'hand_tools', 'heavy_lifting', 'site_safety'],
    related: ['carpenter', 'production_worker', 'warehouse_associate'],
    certifications: ['osha_10'],
    queryWords: ['construction']
  },
  {
    id: 'welder',
    label: 'Welder',
    family: 'trades',
    titles: ['welder', 'welder fabricator', 'mig welder', 'tig welder', 'fabricator', 'schweisser'],
    skills: ['welding', 'blueprints', 'fabrication'],
    related: ['production_worker'],
    certifications: ['welding_cert']
  },
  {
    id: 'production_worker',
    label: 'Production / Manufacturing Associate',
    family: 'manufacturing',
    titles: [
      'production worker',
      'production associate',
      'production operator',
      'manufacturing associate',
      'manufacturing technician',
      'assembly worker',
      'assembler',
      'machine operator',
      'line worker',
      'factory worker',
      'packaging operator',
      'production team member',
      'cnc operator',
      'machinist',
      'produktionsmitarbeiter',
      'operateur de production'
    ],
    skills: [
      'machine_operation',
      'assembly',
      'quality_checks',
      'gmp',
      'heavy_lifting',
      'lean',
      'hand_tools'
    ],
    related: ['quality_inspector', 'warehouse_associate', 'maintenance_technician', 'welder'],
    queryWords: ['manufacturing', 'production', 'factory']
  },
  {
    id: 'quality_inspector',
    label: 'Quality Inspector',
    family: 'manufacturing',
    titles: [
      'quality inspector',
      'quality control inspector',
      'qc inspector',
      'quality technician',
      'quality control technician',
      'quality assurance inspector'
    ],
    skills: ['quality_checks', 'measuring_tools', 'gmp', 'blueprints', 'iso_9001'],
    related: ['production_worker']
  },
  {
    id: 'auto_technician',
    label: 'Automotive Technician',
    family: 'trades',
    titles: [
      'automotive technician',
      'auto mechanic',
      'mechanic',
      'diesel mechanic',
      'diesel technician',
      'service technician automotive',
      'lube technician',
      'tire technician',
      'kfz mechatroniker'
    ],
    skills: ['vehicle_diagnostics', 'hand_tools', 'power_tools'],
    related: ['maintenance_technician'],
    certifications: ['ase']
  },
  // ---------------------------------------------------------------- finance / hr / legal
  {
    id: 'bookkeeper',
    label: 'Bookkeeper / Accounting Clerk',
    family: 'finance',
    titles: [
      'bookkeeper',
      'accounting clerk',
      'accounts payable clerk',
      'accounts receivable clerk',
      'accounts payable specialist',
      'accounts receivable specialist',
      'billing clerk',
      'payroll clerk',
      'accounting assistant',
      'payroll specialist',
      'buchhalter'
    ],
    skills: [
      'bookkeeping',
      'quickbooks',
      'accounts_payable',
      'accounts_receivable',
      'excel',
      'reconciliation',
      'payroll'
    ],
    related: ['accountant', 'administrative_assistant', 'medical_billing']
  },
  {
    id: 'accountant',
    label: 'Accountant',
    family: 'finance',
    titles: [
      'accountant',
      'staff accountant',
      'senior accountant',
      'cpa',
      'auditor',
      'tax accountant',
      'financial accountant',
      'cost accountant',
      'controller',
      'financial analyst'
    ],
    skills: ['gaap', 'reconciliation', 'excel', 'financial_reporting', 'erp', 'tax'],
    related: ['bookkeeper'],
    certifications: ['cpa']
  },
  {
    id: 'hr_generalist',
    label: 'HR Generalist / Coordinator',
    family: 'hr',
    titles: [
      'hr generalist',
      'human resources generalist',
      'hr coordinator',
      'hr assistant',
      'hr specialist',
      'human resources coordinator',
      'human resources assistant',
      'human resources specialist',
      'people operations',
      'hr business partner',
      'hr manager',
      'human resources manager',
      'personalreferent'
    ],
    skills: [
      'hris',
      'onboarding',
      'employee_relations',
      'benefits_admin',
      'payroll',
      'compliance_hr'
    ],
    related: ['recruiter', 'administrative_assistant'],
    queryWords: ['hr', 'human resources']
  },
  {
    id: 'recruiter',
    label: 'Recruiter',
    family: 'hr',
    titles: [
      'recruiter',
      'talent acquisition',
      'technical recruiter',
      'recruiting coordinator',
      'sourcer',
      'talent acquisition specialist',
      'recruitment consultant'
    ],
    skills: ['sourcing', 'ats_software', 'interviewing', 'onboarding'],
    related: ['hr_generalist', 'sales_representative']
  },
  {
    id: 'paralegal',
    label: 'Paralegal / Legal Assistant',
    family: 'legal',
    titles: [
      'paralegal',
      'legal assistant',
      'legal secretary',
      'litigation assistant',
      'litigation paralegal',
      'corporate paralegal',
      'legal clerk'
    ],
    skills: ['legal_research', 'case_management', 'legal_documents', 'e_discovery', 'filing'],
    related: ['lawyer', 'administrative_assistant'],
    queryWords: ['legal']
  },
  {
    id: 'lawyer',
    label: 'Attorney',
    family: 'legal',
    titles: [
      'attorney',
      'lawyer',
      'counsel',
      'associate attorney',
      'solicitor',
      'legal counsel',
      'general counsel',
      'rechtsanwalt'
    ],
    skills: ['legal_research', 'litigation', 'contracts', 'legal_documents'],
    related: ['paralegal'],
    certifications: ['bar_admission']
  },
  // ---------------------------------------------------------------- education / care
  {
    id: 'teacher',
    label: 'Teacher',
    family: 'education',
    titles: [
      'teacher',
      'substitute teacher',
      'classroom teacher',
      'elementary teacher',
      'high school teacher',
      'math teacher',
      'english teacher',
      'esl teacher',
      'special education teacher',
      'lehrer',
      'enseignant',
      'profesor'
    ],
    skills: ['lesson_planning', 'classroom_management', 'curriculum', 'student_assessment'],
    related: ['teaching_assistant', 'tutor', 'childcare_worker'],
    certifications: ['teaching_credential']
  },
  {
    id: 'teaching_assistant',
    label: 'Teaching Assistant',
    family: 'education',
    titles: [
      'teaching assistant',
      'teacher assistant',
      'paraprofessional',
      'instructional aide',
      'classroom aide',
      'paraeducator'
    ],
    skills: ['classroom_management', 'student_support'],
    related: ['teacher', 'childcare_worker', 'tutor']
  },
  {
    id: 'childcare_worker',
    label: 'Childcare Worker',
    family: 'education',
    titles: [
      'childcare worker',
      'child care provider',
      'daycare teacher',
      'preschool teacher',
      'nanny',
      'babysitter',
      'child care assistant',
      'early childhood educator',
      'erzieher'
    ],
    skills: ['child_development', 'classroom_management', 'first_aid_skill'],
    related: ['teaching_assistant', 'teacher'],
    certifications: ['cpr']
  },
  {
    id: 'tutor',
    label: 'Tutor',
    family: 'education',
    titles: ['tutor', 'online tutor', 'math tutor', 'academic tutor', 'reading tutor'],
    skills: ['lesson_planning', 'student_support'],
    related: ['teacher', 'teaching_assistant']
  },
  // ---------------------------------------------------------------- technology
  {
    id: 'frontend_developer',
    label: 'Frontend Developer',
    family: 'software',
    titles: [
      'frontend developer',
      'front end developer',
      'front-end developer',
      'frontend engineer',
      'front end engineer',
      'front-end engineer',
      'ui engineer',
      'ui developer',
      'react developer',
      'react engineer',
      'vue developer',
      'angular developer',
      'javascript developer',
      'web developer',
      'web engineer',
      'frontend web developer',
      'svelte developer',
      'next.js developer',
      'frontend',
      'front end'
    ],
    skills: [
      'javascript',
      'typescript',
      'react',
      'vue',
      'angular',
      'html',
      'css',
      'nextjs',
      'tailwind',
      'redux',
      'web_accessibility',
      'responsive_design',
      'git',
      'rest_api',
      'jest'
    ],
    related: ['fullstack_developer', 'software_engineer', 'mobile_developer', 'ux_designer'],
    queryWords: ['frontend', 'front-end', 'react']
  },
  {
    id: 'backend_developer',
    label: 'Backend Developer',
    family: 'software',
    titles: [
      'backend developer',
      'back end developer',
      'back-end developer',
      'backend engineer',
      'back end engineer',
      'back-end engineer',
      'api engineer',
      'server engineer',
      'java developer',
      'python developer',
      'node developer',
      'nodejs developer',
      'golang engineer',
      'go engineer',
      '.net developer',
      'dotnet developer',
      'c# developer',
      'php developer',
      'ruby developer',
      'rails developer',
      'django developer',
      'backend'
    ],
    skills: [
      'python',
      'java',
      'nodejs',
      'go',
      'csharp',
      'php',
      'ruby',
      'sql',
      'postgresql',
      'rest_api',
      'microservices',
      'docker',
      'aws',
      'git',
      'kafka'
    ],
    related: ['fullstack_developer', 'software_engineer', 'devops_engineer', 'data_engineer'],
    queryWords: ['backend', 'back-end']
  },
  {
    id: 'fullstack_developer',
    label: 'Full-Stack Developer',
    family: 'software',
    titles: [
      'full stack developer',
      'fullstack developer',
      'full-stack developer',
      'full stack engineer',
      'fullstack engineer',
      'full-stack engineer',
      'full stack web developer'
    ],
    skills: [
      'javascript',
      'typescript',
      'react',
      'nodejs',
      'python',
      'sql',
      'postgresql',
      'rest_api',
      'html',
      'css',
      'git',
      'docker',
      'aws'
    ],
    related: ['frontend_developer', 'backend_developer', 'software_engineer'],
    queryWords: ['fullstack', 'full-stack']
  },
  {
    id: 'software_engineer',
    label: 'Software Engineer',
    family: 'software',
    titles: [
      'software engineer',
      'software developer',
      'software development engineer',
      'sde',
      'programmer',
      'application developer',
      'swe',
      'software engineering',
      'developer',
      'engineer software',
      'softwareentwickler',
      'desarrollador de software',
      'developpeur'
    ],
    skills: [
      'javascript',
      'typescript',
      'python',
      'java',
      'csharp',
      'go',
      'sql',
      'git',
      'rest_api',
      'algorithms',
      'docker',
      'aws',
      'testing'
    ],
    related: [
      'frontend_developer',
      'backend_developer',
      'fullstack_developer',
      'mobile_developer',
      'devops_engineer',
      'qa_engineer',
      'data_engineer'
    ],
    queryWords: ['software', 'programming', 'coding', 'developer']
  },
  {
    id: 'mobile_developer',
    label: 'Mobile Developer',
    family: 'software',
    titles: [
      'ios developer',
      'android developer',
      'mobile engineer',
      'mobile developer',
      'react native developer',
      'flutter developer',
      'ios engineer',
      'android engineer'
    ],
    skills: ['swift', 'kotlin', 'react_native', 'flutter', 'ios', 'android', 'git'],
    related: ['frontend_developer', 'software_engineer'],
    queryWords: ['ios', 'android', 'mobile']
  },
  {
    id: 'devops_engineer',
    label: 'DevOps / SRE',
    family: 'software',
    titles: [
      'devops engineer',
      'site reliability engineer',
      'sre',
      'platform engineer',
      'cloud engineer',
      'infrastructure engineer',
      'devops',
      'build engineer',
      'release engineer'
    ],
    skills: [
      'aws',
      'azure',
      'gcp',
      'kubernetes',
      'docker',
      'terraform',
      'ci_cd',
      'linux',
      'python',
      'monitoring'
    ],
    related: ['backend_developer', 'sysadmin', 'software_engineer']
  },
  {
    id: 'data_analyst',
    label: 'Data Analyst',
    family: 'data',
    titles: [
      'data analyst',
      'reporting analyst',
      'bi analyst',
      'business intelligence analyst',
      'analytics analyst',
      'marketing analyst',
      'insights analyst',
      'data analytics'
    ],
    skills: [
      'sql',
      'excel',
      'tableau',
      'power_bi',
      'python',
      'statistics',
      'data_visualization',
      'looker'
    ],
    related: ['data_scientist', 'business_analyst', 'data_engineer']
  },
  {
    id: 'data_scientist',
    label: 'Data Scientist / ML Engineer',
    family: 'data',
    titles: [
      'data scientist',
      'machine learning engineer',
      'ml engineer',
      'ai engineer',
      'applied scientist',
      'research scientist machine learning',
      'deep learning engineer',
      'nlp engineer'
    ],
    skills: [
      'python',
      'machine_learning',
      'statistics',
      'sql',
      'pytorch',
      'tensorflow',
      'pandas',
      'deep_learning'
    ],
    related: ['data_analyst', 'data_engineer', 'software_engineer']
  },
  {
    id: 'data_engineer',
    label: 'Data Engineer',
    family: 'data',
    titles: [
      'data engineer',
      'analytics engineer',
      'etl developer',
      'big data engineer',
      'data platform engineer'
    ],
    skills: ['sql', 'python', 'spark', 'airflow', 'dbt', 'etl', 'aws', 'snowflake', 'kafka'],
    related: ['data_analyst', 'data_scientist', 'backend_developer']
  },
  {
    id: 'qa_engineer',
    label: 'QA / Test Engineer',
    family: 'software',
    titles: [
      'qa engineer',
      'qa tester',
      'quality assurance engineer',
      'test engineer',
      'sdet',
      'qa analyst',
      'software tester',
      'test automation engineer',
      'quality assurance analyst',
      'qa automation engineer'
    ],
    skills: [
      'testing',
      'selenium',
      'cypress',
      'playwright',
      'test_automation',
      'jira',
      'api_testing'
    ],
    related: ['software_engineer']
  },
  {
    id: 'it_support',
    label: 'IT Support / Help Desk',
    family: 'it',
    titles: [
      'it support',
      'help desk',
      'helpdesk',
      'help desk technician',
      'desktop support',
      'it technician',
      'service desk analyst',
      'technical support specialist',
      'it specialist',
      'it support specialist',
      'desktop technician',
      'computer technician',
      'field technician it',
      'it support technician'
    ],
    skills: [
      'windows',
      'active_directory',
      'troubleshooting_it',
      'ticketing',
      'networking',
      'office365',
      'hardware'
    ],
    related: ['sysadmin', 'customer_service_rep'],
    certifications: ['comptia_a']
  },
  {
    id: 'sysadmin',
    label: 'Systems / Network Administrator',
    family: 'it',
    titles: [
      'system administrator',
      'systems administrator',
      'sysadmin',
      'network administrator',
      'network engineer',
      'it administrator',
      'systems engineer',
      'database administrator',
      'dba',
      'sql server dba',
      'sql server',
      'database engineer'
    ],
    skills: [
      'linux',
      'windows',
      'active_directory',
      'networking',
      'vmware',
      'scripting',
      'security_basics'
    ],
    related: ['it_support', 'devops_engineer', 'security_engineer']
  },
  {
    id: 'security_engineer',
    label: 'Cybersecurity',
    family: 'it',
    titles: [
      'security engineer',
      'cybersecurity analyst',
      'cyber security analyst',
      'information security analyst',
      'soc analyst',
      'penetration tester',
      'security analyst',
      'application security engineer'
    ],
    skills: [
      'security_basics',
      'siem',
      'networking',
      'incident_response',
      'vulnerability_management',
      'python'
    ],
    related: ['sysadmin', 'devops_engineer'],
    queryWords: ['cybersecurity', 'infosec']
  },
  {
    id: 'product_manager',
    label: 'Product Manager',
    family: 'product',
    titles: [
      'product manager',
      'product owner',
      'technical product manager',
      'associate product manager',
      'senior product manager',
      'group product manager'
    ],
    skills: [
      'roadmapping',
      'user_research',
      'agile',
      'jira',
      'analytics_product',
      'stakeholder_management'
    ],
    related: ['project_manager', 'business_analyst', 'ux_designer']
  },
  {
    id: 'project_manager',
    label: 'Project / Program Manager',
    family: 'product',
    titles: [
      'project manager',
      'program manager',
      'project coordinator',
      'scrum master',
      'delivery manager',
      'project lead',
      'pmo analyst'
    ],
    skills: [
      'project_management',
      'agile',
      'scrum',
      'jira',
      'stakeholder_management',
      'budgeting',
      'ms_project'
    ],
    related: ['product_manager', 'operations_coordinator', 'operations_manager'],
    certifications: ['pmp']
  },
  {
    id: 'business_analyst',
    label: 'Business Analyst',
    family: 'data',
    titles: [
      'business analyst',
      'business systems analyst',
      'operations analyst',
      'systems analyst',
      'process analyst'
    ],
    skills: [
      'requirements_gathering',
      'sql',
      'excel',
      'process_mapping',
      'stakeholder_management',
      'jira'
    ],
    related: ['data_analyst', 'product_manager', 'project_manager']
  },
  {
    id: 'ux_designer',
    label: 'UX / Product Designer',
    family: 'design',
    titles: [
      'ux designer',
      'ui designer',
      'product designer',
      'ux researcher',
      'interaction designer',
      'ui/ux designer',
      'ux/ui designer',
      'user experience designer'
    ],
    skills: [
      'figma',
      'user_research',
      'prototyping',
      'wireframing',
      'design_systems',
      'usability_testing'
    ],
    related: ['graphic_designer', 'frontend_developer', 'product_manager']
  },
  {
    id: 'graphic_designer',
    label: 'Graphic Designer',
    family: 'design',
    titles: [
      'graphic designer',
      'visual designer',
      'brand designer',
      'motion designer',
      'production artist',
      'junior designer',
      'creative designer',
      'illustrator'
    ],
    skills: ['adobe_photoshop', 'adobe_illustrator', 'indesign', 'typography', 'branding', 'figma'],
    related: ['ux_designer', 'marketing_coordinator']
  },
  // ---------------------------------------------------------------- marketing / sales / management
  {
    id: 'marketing_coordinator',
    label: 'Marketing',
    family: 'marketing',
    titles: [
      'marketing coordinator',
      'marketing specialist',
      'marketing associate',
      'marketing manager',
      'digital marketing specialist',
      'digital marketing manager',
      'seo specialist',
      'content marketer',
      'growth marketer',
      'social media coordinator',
      'social media manager',
      'social media specialist',
      'marketing assistant',
      'email marketing specialist',
      'performance marketing manager'
    ],
    skills: [
      'seo',
      'google_analytics',
      'social_media',
      'email_marketing',
      'content_creation',
      'paid_ads',
      'hubspot',
      'copywriting'
    ],
    related: ['content_writer', 'graphic_designer', 'sales_representative'],
    queryWords: ['marketing']
  },
  {
    id: 'content_writer',
    label: 'Writer / Editor',
    family: 'marketing',
    titles: [
      'content writer',
      'copywriter',
      'technical writer',
      'editor',
      'writer',
      'content editor',
      'content strategist',
      'journalist'
    ],
    skills: ['copywriting', 'editing', 'seo', 'content_creation', 'technical_writing'],
    related: ['marketing_coordinator']
  },
  {
    id: 'sales_representative',
    label: 'Sales Representative',
    family: 'sales',
    titles: [
      'sales representative',
      'sales rep',
      'account executive',
      'business development representative',
      'sales development representative',
      'sdr',
      'bdr',
      'inside sales',
      'outside sales',
      'sales consultant',
      'sales executive',
      'territory sales',
      'sales specialist',
      'business development manager',
      'sales manager'
    ],
    skills: [
      'prospecting',
      'crm',
      'salesforce',
      'negotiation',
      'cold_calling',
      'pipeline_management',
      'quota_attainment'
    ],
    related: ['customer_success', 'customer_service_rep', 'retail_associate'],
    queryWords: ['sales']
  },
  {
    id: 'customer_success',
    label: 'Customer Success / Account Manager',
    family: 'sales',
    titles: [
      'customer success manager',
      'customer success specialist',
      'customer success associate',
      'account manager',
      'client success manager',
      'client manager',
      'implementation specialist',
      'onboarding specialist'
    ],
    skills: ['crm', 'salesforce', 'account_management', 'onboarding', 'stakeholder_management'],
    related: ['sales_representative', 'customer_service_rep']
  },
  {
    id: 'operations_manager',
    label: 'Operations Manager',
    family: 'management',
    titles: [
      'operations manager',
      'general manager',
      'plant manager',
      'facility manager',
      'site manager',
      'operations director',
      'director of operations',
      'area manager',
      'district manager'
    ],
    skills: [
      'team_leadership',
      'pnl',
      'lean',
      'scheduling',
      'budgeting',
      'hiring',
      'kpi_management'
    ],
    related: [
      'warehouse_supervisor',
      'store_manager',
      'office_manager',
      'operations_coordinator',
      'project_manager'
    ]
  }
]

export const OCCUPATION_BY_ID = new Map(OCCUPATIONS.map((o) => [o.id, o]))

export function occupationLabel(id: string): string {
  return OCCUPATION_BY_ID.get(id)?.label ?? id
}
