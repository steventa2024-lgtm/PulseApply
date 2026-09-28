/**
 * SYNTHETIC provider payloads shaped like each provider's documented API
 * response. They exist to test parsing, filtering and fault handling offline.
 * They are NOT live data and never appear in the app.
 */

const filler = Array.from({ length: 48 }, (_, i) => ({
  id: String(6000 + i),
  title: 'Accounts Payable Clerk',
  description: 'Process invoices and vendor payments.',
  created: '2026-09-20T10:00:00Z',
  redirect_url: `https://www.adzuna.com/land/ad/${6000 + i}`,
  company: { display_name: `Filler Co ${i}` },
  location: { display_name: 'Los Angeles, California', area: ['US', 'California', 'Los Angeles County', 'Los Angeles'] },
  latitude: 34.05,
  longitude: -118.24,
  salary_is_predicted: '0'
}))

/** Page 1 is a full page of 50 (so the client must request page 2), page 2 has the rest. */
export const adzunaPage = (page: number) => ({
  count: 51,
  results:
    page === 1
      ? [
          ...filler,
          {
            id: '5001',
            title: 'Warehouse Associate',
            description: 'Pick, pack and ship orders using RF scanners. Forklift certification preferred. Lift up to 50 lbs.',
            created: '2026-09-20T10:00:00Z',
            redirect_url: 'https://www.adzuna.com/land/ad/5001?se=test',
            company: { display_name: 'Pacific Coast Logistics' },
            location: { display_name: 'Carson, Los Angeles County', area: ['US', 'California', 'Los Angeles County', 'Carson'] },
            latitude: 33.8314,
            longitude: -118.282,
            salary_min: 41600,
            salary_max: 45760,
            salary_is_predicted: '0',
            contract_time: 'full_time',
            category: { label: 'Logistics & Warehouse Jobs' }
          },
          {
            id: '5002',
            title: 'Paralegal',
            description: 'Draft legal documents, customer service, calendaring deadlines.',
            created: '2026-09-21T10:00:00Z',
            redirect_url: 'https://www.adzuna.com/land/ad/5002',
            company: { display_name: 'Westside Law Group' },
            location: { display_name: 'Los Angeles, California', area: ['US', 'California', 'Los Angeles County', 'Los Angeles'] },
            latitude: 34.05,
            longitude: -118.24,
            salary_min: 60000,
            salary_max: 70000,
            salary_is_predicted: '1'
          }
        ]
      : page === 2
        ? [
            {
              id: '5003',
              title: 'Material Handler - Night Shift',
              description: 'Material handler for our distribution center. Pallet jack experience. Night shift.',
              created: '2026-09-22T10:00:00Z',
              redirect_url: 'https://www.adzuna.com/land/ad/5003',
              company: { display_name: 'Pacific Coast Logistics' },
              location: { display_name: 'Riverside, California', area: ['US', 'California', 'Riverside County', 'Riverside'] },
              latitude: 33.9533,
              longitude: -117.3962,
              salary_is_predicted: '0'
            }
          ]
        : []
})

export const remotiveBody = {
  'job-count': 2,
  jobs: [
    {
      id: 901,
      url: 'https://remotive.com/remote-jobs/software-dev/junior-frontend-developer-901',
      title: 'Junior Frontend Developer',
      company_name: 'Acme Remote',
      category: 'Software Development',
      tags: ['react', 'typescript'],
      job_type: 'full_time',
      publication_date: '2026-09-25T08:00:00',
      candidate_required_location: 'USA Only',
      salary: '$70,000 - $90,000',
      description: '<p>Build React UIs.</p><h3>Requirements</h3><ul><li>React and TypeScript</li><li>HTML/CSS</li></ul><script>alert(1)</script>'
    },
    {
      id: 902,
      url: 'https://remotive.com/remote-jobs/software-dev/frontend-engineer-902',
      title: 'Frontend Engineer',
      company_name: 'Euro Remote GmbH',
      job_type: 'full_time',
      publication_date: '2026-09-24T08:00:00',
      candidate_required_location: 'Europe',
      description: '<p>React engineer, CET timezone.</p>'
    }
  ]
}

export const greenhouseJobs = {
  jobs: [
    {
      id: 7001,
      internal_job_id: 99,
      title: 'Warehouse Associate',
      updated_at: '2026-09-26T12:00:00-04:00',
      first_published: '2026-09-10T12:00:00-04:00',
      requisition_id: 'REQ-100',
      location: { name: 'Carson, CA' },
      absolute_url: 'https://boards.greenhouse.io/examplelogistics/jobs/7001',
      content: '&lt;p&gt;Pick and pack orders with RF scanners.&lt;/p&gt;&lt;h3&gt;Requirements&lt;/h3&gt;&lt;ul&gt;&lt;li&gt;Pallet jack&lt;/li&gt;&lt;/ul&gt;',
      departments: [{ name: 'Operations' }],
      offices: [{ name: 'Carson', location: 'Carson, CA' }]
    },
    {
      id: 7002,
      title: 'Warehouse Associate - Night Shift',
      updated_at: '2026-09-26T12:00:00-04:00',
      requisition_id: 'REQ-101',
      location: { name: 'Carson, CA' },
      absolute_url: 'https://boards.greenhouse.io/examplelogistics/jobs/7002',
      content: '&lt;p&gt;Night shift order picking.&lt;/p&gt;'
    },
    {
      id: 7003,
      title: 'HR Generalist',
      location: { name: 'Carson, CA' },
      absolute_url: 'https://boards.greenhouse.io/examplelogistics/jobs/7003',
      content: '&lt;p&gt;HR, customer service mindset.&lt;/p&gt;'
    }
  ],
  meta: { total: 3 }
}

export const leverPostings = [
  {
    id: '1b2c3d4e-0000-4000-8000-000000000001',
    text: 'Barista',
    hostedUrl: 'https://jobs.lever.co/examplecoffee/1b2c3d4e-0000-4000-8000-000000000001',
    applyUrl: 'https://jobs.lever.co/examplecoffee/1b2c3d4e-0000-4000-8000-000000000001/apply',
    createdAt: 1790000000000,
    country: 'US',
    workplaceType: 'on-site',
    categories: { commitment: 'Part-time', location: 'Long Beach, CA', team: 'Cafe' },
    description: '<p>Make espresso drinks, steam milk, handle POS and cash.</p>',
    lists: [{ text: 'Requirements', content: '<li>Food handler card</li><li>Customer service</li>' }],
    salaryRange: { min: 19, max: 22, currency: 'USD', interval: 'per-hour-wage' }
  }
]

export const usajobsBody = {
  SearchResult: {
    SearchResultCountAll: 1,
    SearchResultItems: [
      {
        MatchedObjectId: '800001',
        MatchedObjectDescriptor: {
          PositionID: 'DLA-26-0001',
          PositionTitle: 'Materials Handler',
          PositionURI: 'https://www.usajobs.gov/job/800001',
          ApplyURI: ['https://www.usajobs.gov/job/800001/apply'],
          PositionLocationDisplay: 'Torrance, California',
          PositionLocation: [{ LocationName: 'Torrance, California', CountryCode: 'United States', CountrySubDivisionCode: 'California', CityName: 'Torrance, California', Longitude: -118.3406, Latitude: 33.8358 }],
          OrganizationName: 'Defense Logistics Agency',
          DepartmentName: 'Department of Defense',
          PositionSchedule: [{ Name: 'Full-time' }],
          PositionRemuneration: [{ MinimumRange: '22.10', MaximumRange: '25.80', RateIntervalCode: 'PH' }],
          PublicationStartDate: '2026-09-15T00:00:00.0000',
          ApplicationCloseDate: '2099-10-15T23:59:59.9970',
          QualificationSummary: 'Experience operating forklifts and pallet jacks.',
          UserArea: { Details: { JobSummary: 'Receive, store and issue materials.', WhoMayApply: { Name: 'United States Citizens' }, TeleworkEligible: false, RemoteIndicator: false } }
        }
      }
    ]
  }
}
