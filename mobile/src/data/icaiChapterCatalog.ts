import type { DailyMcqQuestion } from './dailyMcqBank';

export type OfficialMcqChapter = {
  id: string;
  subject: DailyMcqQuestion['subject'];
  paper: string;
  section?: string;
  part?: string;
  module: string;
  chapterNumber: number;
  title: string;
  officialTitle: string;
  displayTitle: string;
  sourceUrl: string;
  catalogOrder: number;
};

type ChapterGroup = Omit<OfficialMcqChapter, 'id' | 'chapterNumber' | 'title' | 'officialTitle' | 'displayTitle' | 'catalogOrder'> & {
  idPrefix: string;
  chapters: Array<[number, string]>;
};

const chapterGroups: ChapterGroup[] = [
  {
    idPrefix: 'advanced-accounting',
    subject: 'Accounts',
    paper: 'Paper 1: Advanced Accounting',
    module: 'Module 1',
    sourceUrl: 'https://boslive.icai.org/sm_chapter_details.php?p_id=144&m_id=158',
    chapters: [
      [1, 'Introduction to Accounting Standards'],
      [2, 'Framework for Preparation and Presentation of Financial Statements'],
      [3, 'Applicability of Accounting Standards'],
      [4, 'Presentation & Disclosures Based Accounting Standards'],
    ],
  },
  {
    idPrefix: 'advanced-accounting',
    subject: 'Accounts',
    paper: 'Paper 1: Advanced Accounting',
    module: 'Module 2',
    sourceUrl: 'https://boslive.icai.org/sm_chapter_details.php?p_id=144&m_id=159',
    chapters: [
      [5, 'Assets Based Accounting Standards'],
      [6, 'Liabilities Based Accounting Standards'],
      [7, 'Accounting Standards Based on Items Impacting Financial Statement'],
      [8, 'Revenue Based Accounting Standards'],
      [9, 'Other Accounting Standards'],
      [10, 'Accounting Standards for Consolidated Financial Statement'],
    ],
  },
  {
    idPrefix: 'advanced-accounting',
    subject: 'Accounts',
    paper: 'Paper 1: Advanced Accounting',
    module: 'Module 3',
    sourceUrl: 'https://boslive.icai.org/sm_chapter_details.php?p_id=144&m_id=160',
    chapters: [
      [11, 'Financial Statements of Companies'],
      [12, 'Buyback of Securities'],
      [13, 'Amalgamation of Companies'],
      [14, 'Internal Reconstruction'],
      [15, 'Accounting for Branches including Foreign Branches'],
    ],
  },
  {
    idPrefix: 'corporate-laws',
    subject: 'Law',
    paper: 'Paper 2: Corporate and Other Laws',
    part: 'Part I — Company Law and Limited Liability Partnership Law',
    module: 'Module 1',
    sourceUrl: 'https://boslive.icai.org/sm_chapter_details.php?p_id=145&m_id=161',
    chapters: [
      [1, 'Preliminary'],
      [2, 'Incorporation of Company and Matters Incidental Thereto'],
      [3, 'Prospectus and Allotment of Securities'],
      [4, 'Share Capital and Debentures'],
      [5, 'Acceptance of Deposits by Companies'],
      [6, 'Registration of Charges'],
    ],
  },
  {
    idPrefix: 'corporate-laws',
    subject: 'Law',
    paper: 'Paper 2: Corporate and Other Laws',
    part: 'Part I — Company Law and Limited Liability Partnership Law',
    module: 'Module 2',
    sourceUrl: 'https://boslive.icai.org/sm_chapter_details.php?p_id=145&m_id=162',
    chapters: [
      [7, 'Management & Administration'],
      [8, 'Declaration and Payment of Dividend'],
      [9, 'Accounts of Companies'],
      [10, 'Audit and Auditors'],
      [11, 'Companies Incorporated Outside India'],
    ],
  },
  {
    idPrefix: 'corporate-laws',
    subject: 'Law',
    paper: 'Paper 2: Corporate and Other Laws',
    part: 'Part I — Company Law and Limited Liability Partnership Law',
    module: 'Module 3',
    sourceUrl: 'https://boslive.icai.org/sm_chapter_details.php?p_id=145&m_id=163',
    chapters: [[12, 'The Limited Liability Partnership Act, 2008']],
  },
  {
    idPrefix: 'other-laws',
    subject: 'Law',
    paper: 'Paper 2: Corporate and Other Laws',
    part: 'Part II — Other Laws',
    module: 'Module 3',
    sourceUrl: 'https://boslive.icai.org/sm_unit_details.php?c_id=1107',
    chapters: [
      [1, 'The General Clauses Act, 1897'],
      [2, 'Interpretation of Statutes'],
      [3, 'The Foreign Exchange Management Act, 1999'],
    ],
  },
  {
    idPrefix: 'income-tax',
    subject: 'Taxation',
    paper: 'Paper 3: Taxation',
    section: 'Section A: Income-tax Law',
    module: 'Module 1',
    sourceUrl: 'https://boslive.icai.org/sm_chapter_details.php?p_id=137&m_id=155',
    chapters: [
      [1, 'Basic Concepts'],
      [2, 'Residence and Scope of Total Income'],
      [3, 'Heads of Income'],
    ],
  },
  {
    idPrefix: 'income-tax',
    subject: 'Taxation',
    paper: 'Paper 3: Taxation',
    section: 'Section A: Income-tax Law',
    module: 'Module 2',
    sourceUrl: 'https://boslive.icai.org/sm_chapter_details.php?p_id=137&m_id=154',
    chapters: [
      [4, 'Income of Other Persons included in Assessee’s Total Income'],
      [5, 'Aggregation of Income, Set-Off and Carry Forward of Losses'],
      [6, 'Deductions from Gross Total Income'],
      [7, 'Advance Tax, Tax Deduction at Source and Tax Collection at Source'],
      [8, 'Provisions for filing Return of Income and Self Assessment'],
      [9, 'Income Tax Liability - Computation and Optimisation'],
    ],
  },
  {
    idPrefix: 'gst',
    subject: 'Taxation',
    paper: 'Paper 3: Taxation',
    section: 'Section B: Goods and Services Tax',
    module: 'Module 1',
    sourceUrl: 'https://boslive.icai.org/sm_chapter_details.php?p_id=136&m_id=153',
    chapters: [
      [1, 'GST in India - An Introduction'],
      [2, 'Supply under GST'],
      [3, 'Charge of GST'],
      [4, 'Place of Supply'],
      [5, 'Exemptions from GST'],
      [6, 'Time of Supply'],
      [7, 'Value of Supply'],
    ],
  },
  {
    idPrefix: 'gst',
    subject: 'Taxation',
    paper: 'Paper 3: Taxation',
    section: 'Section B: Goods and Services Tax',
    module: 'Module 2',
    sourceUrl: 'https://boslive.icai.org/sm_chapter_details.php?p_id=136&m_id=156',
    chapters: [
      [8, 'Input Tax Credit'],
      [9, 'Registration'],
      [10, 'Tax Invoice; Credit and Debit Notes'],
      [11, 'Accounts and Records'],
      [12, 'E-Way Bill'],
      [13, 'Payment of Tax'],
      [14, 'Tax Deduction at Source and Collection of Tax at Source'],
      [15, 'Returns'],
    ],
  },
  {
    idPrefix: 'costing',
    subject: 'Costing',
    paper: 'Paper 4: Cost and Management Accounting',
    module: 'Module 1',
    sourceUrl: 'https://boslive.icai.org/sm_chapter_details.php?p_id=146&m_id=164',
    chapters: [
      [1, 'Introduction to Cost and Management Accounting'],
      [2, 'Material Cost'],
      [3, 'Employee Cost and Direct Expenses'],
      [4, 'Overheads – Absorption Costing Method'],
      [5, 'Activity Based Costing'],
      [6, 'Cost Sheet'],
      [7, 'Cost Accounting Systems'],
    ],
  },
  {
    idPrefix: 'costing',
    subject: 'Costing',
    paper: 'Paper 4: Cost and Management Accounting',
    module: 'Module 2',
    sourceUrl: 'https://boslive.icai.org/sm_chapter_details.php?p_id=146&m_id=165',
    chapters: [
      [8, 'Unit & Batch Costing'],
      [9, 'Job Costing'],
      [10, 'Process & Operation Costing'],
      [11, 'Joint Products and By Products'],
      [12, 'Service Costing'],
      [13, 'Standard Costing'],
      [14, 'Marginal Costing'],
      [15, 'Budgets and Budgetary Control'],
    ],
  },
  {
    idPrefix: 'audit',
    subject: 'Audit',
    paper: 'Paper 5: Auditing and Ethics',
    module: 'Module 1',
    sourceUrl: 'https://boslive.icai.org/sm_chapter_details.php?p_id=147&m_id=166',
    chapters: [
      [1, 'Nature, Objective and Scope of Audit'],
      [2, 'Audit Strategy, Audit Planning and Audit Programme'],
      [3, 'Risk Assessment and Internal Control'],
      [4, 'Audit Evidence'],
      [5, 'Audit of Items of Financial Statements'],
    ],
  },
  {
    idPrefix: 'audit',
    subject: 'Audit',
    paper: 'Paper 5: Auditing and Ethics',
    module: 'Module 2',
    sourceUrl: 'https://boslive.icai.org/sm_chapter_details.php?p_id=147&m_id=167',
    chapters: [
      [6, 'Audit Documentation'],
      [7, 'Completion and Review'],
      [8, 'Audit Report'],
      [9, 'Special Features of Audit of Different Type of Entities'],
      [10, 'Audit of Banks'],
      [11, 'Ethics and Terms of Audit Engagements'],
    ],
  },
  {
    idPrefix: 'financial-management',
    subject: 'FM',
    paper: 'Paper 6: Financial Management and Strategic Management',
    section: 'Section A: Financial Management',
    module: 'Module 1',
    sourceUrl: 'https://boslive.icai.org/sm_chapter_details.php?p_id=151&m_id=177',
    chapters: [
      [1, 'Scope and Objectives of Financial Management'],
      [2, 'Types of Financing'],
      [3, 'Financial Analysis and Planning – Ratio Analysis'],
      [4, 'Cost of Capital'],
      [5, 'Financing Decisions – Capital Structure'],
      [6, 'Financing Decisions – Leverages'],
    ],
  },
  {
    idPrefix: 'financial-management',
    subject: 'FM',
    paper: 'Paper 6: Financial Management and Strategic Management',
    section: 'Section A: Financial Management',
    module: 'Module 2',
    sourceUrl: 'https://boslive.icai.org/sm_chapter_details.php?p_id=151&m_id=178',
    chapters: [
      [7, 'Investment Decisions'],
      [8, 'Dividend Decision'],
      [9, 'Management of Working Capital'],
    ],
  },
  {
    idPrefix: 'strategic-management',
    subject: 'SM',
    paper: 'Paper 6: Financial Management and Strategic Management',
    section: 'Section B: Strategic Management',
    module: 'Paper 6B',
    sourceUrl: 'https://boslive.icai.org/sm_chapter_details.php?p_id=156&m_id=185',
    chapters: [
      [1, 'Introduction to Strategic Management'],
      [2, 'Strategic Analysis: External Environment'],
      [3, 'Strategic Analysis: Internal Environment'],
      [4, 'Strategic Choices'],
      [5, 'Strategy Implementation and Evaluation'],
    ],
  },
];

export const officialMcqChapterCatalog: OfficialMcqChapter[] = chapterGroups
  .flatMap((group) => group.chapters.map(([chapterNumber, title]) => ({
    id: `${group.idPrefix}-${chapterNumber}`,
    subject: group.subject,
    paper: group.paper,
    section: group.section,
    part: group.part,
    module: group.module,
    chapterNumber,
    title,
    officialTitle: `Chapter ${chapterNumber}: ${title}`,
    displayTitle: [group.section, group.module, group.part?.startsWith('Part II') ? 'Part II' : undefined, `Chapter ${chapterNumber}: ${title}`].filter(Boolean).join(' · '),
    sourceUrl: group.sourceUrl,
  })))
  .map((chapter, catalogOrder) => ({ ...chapter, catalogOrder }));

const catalogIds = officialMcqChapterCatalog.map((chapter) => chapter.id);
if (new Set(catalogIds).size !== catalogIds.length) throw new Error('The ICAI chapter catalogue contains duplicate IDs.');

export const officialMcqChapterById = Object.fromEntries(
  officialMcqChapterCatalog.map((chapter) => [chapter.id, chapter]),
) as Record<string, OfficialMcqChapter>;
