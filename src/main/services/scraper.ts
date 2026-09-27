export interface ScrapedJobRaw {
  externalId: string
  title: string
  company: string
  location: string
  source: 'Indeed' | 'LinkedIn' | 'ZipRecruiter'
  url: string
  salary?: string
  description: string
  requiredSkills: string[]
}

export async function scrapeTargetJobs(): Promise<ScrapedJobRaw[]> {
  return [
    {
      externalId: 'job_lakewood_101',
      title: 'Warehouse & Operations Lead',
      company: 'Pacific Freight Logistics',
      location: 'Long Beach, CA (Near Lakewood)',
      source: 'Indeed',
      url: 'https://indeed.com',
      salary: '$24.50 - $29.00 / hr',
      description: 'Oversee daily warehouse operations, inventory tracking, dispatch coordination, and spreadsheet logs.',
      requiredSkills: [
        'Warehouse Operations',
        'Inventory Management & Stock Control',
        'Scheduling & Coordination',
        'Data Entry & Basic Excel'
      ]
    },
    {
      externalId: 'job_lakewood_102',
      title: 'Lead Barista & Shift Supervisor',
      company: 'Roast & Steam Artisans',
      location: 'Lakewood, CA',
      source: 'Indeed',
      url: 'https://indeed.com',
      salary: '$20.00 - $24.50 / hr + Tips',
      description: 'Lead high-volume beverage operations, espresso crafting, milk steaming, POS cash handling, and food safety.',
      requiredSkills: [
        'Espresso Machines & Coffee Brewing',
        'Milk Steaming & Beverage Preparation',
        'POS Systems & Cash Handling',
        'Food Safety & Sanitation'
      ]
    },
    {
      externalId: 'job_lakewood_103',
      title: 'Office Coordinator & Operations Admin',
      company: 'Apex Supply Group',
      location: 'Cerritos, CA',
      source: 'LinkedIn',
      url: 'https://linkedin.com',
      salary: '$23.00 - $27.00 / hr',
      description: 'Coordinate office scheduling, maintain documentation, assist customer inquiries, and support logistics.',
      requiredSkills: [
        'Office Administration',
        'Scheduling & Coordination',
        'Data Entry & Basic Excel',
        'Customer Service & Guest Experience'
      ]
    },
    {
      externalId: 'job_lakewood_104',
      title: 'Inventory & Logistics Specialist',
      company: 'Harbor Commercial Distribution',
      location: 'Carson, CA',
      source: 'Indeed',
      url: 'https://indeed.com',
      salary: '$22.50 - $26.50 / hr',
      description: 'Coordinate warehouse supplies, maintain stock accuracy, inspect incoming deliveries, and handle fast-paced floor operations.',
      requiredSkills: [
        'Inventory Management & Stock Control',
        'Warehouse Operations',
        'Fast-Paced Work Environments',
        'Teamwork & Communication'
      ]
    }
  ]
}
