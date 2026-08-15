import { DailyMcqQuestion } from './dailyMcqBank';

export type McqDifficulty = 'Easy' | 'Medium' | 'Hard';

export type EnrichedMcqQuestion = DailyMcqQuestion & {
  chapter: string;
  difficulty: McqDifficulty;
  kind: 'normal' | 'case-study';
};

const chapterById: Record<string, string> = {
  'acc-equation': 'Accounting Fundamentals',
  'acc-accrual': 'Accounting Fundamentals',
  'acc-depreciation': 'Property, Plant and Equipment',
  'acc-trial-balance': 'Accounting Process and Errors',
  'law-contract': 'Indian Contract Act — Basics',
  'law-consent': 'Indian Contract Act — Free Consent',
  'law-offer': 'Indian Contract Act — Offer and Acceptance',
  'law-consideration': 'Indian Contract Act — Consideration',
  'tax-gst': 'GST Fundamentals',
  'tax-itc': 'Input Tax Credit',
  'tax-direct': 'Income-tax Fundamentals',
  'tax-year': 'Income-tax Fundamentals',
  'cost-contribution': 'Marginal Costing',
  'cost-bep': 'Cost-Volume-Profit Analysis',
  'cost-mos': 'Cost-Volume-Profit Analysis',
  'cost-variable': 'Cost Behaviour',
  'audit-sufficiency': 'Audit Evidence',
  'audit-appropriateness': 'Audit Evidence',
  'audit-assurance': 'Nature and Objective of Audit',
  'audit-skepticism': 'Audit Planning and Professional Skepticism',
  'fm-npv': 'Investment Decisions',
  'fm-discount': 'Time Value of Money',
  'fm-working-capital': 'Working Capital Management',
  'fm-irr': 'Investment Decisions',
  'sm-swot': 'Strategic Analysis',
  'sm-mission': 'Strategic Direction',
  'sm-cost-leadership': 'Competitive Strategies',
  'sm-strategy': 'Introduction to Strategic Management',
  'case-g1-asset-ready': 'Property, Plant and Equipment',
  'case-g1-trial-error': 'Accounting Process and Errors',
  'case-g1-counter-offer': 'Indian Contract Act — Offer and Acceptance',
  'case-g1-free-consent': 'Indian Contract Act — Free Consent',
  'case-g1-itc': 'Input Tax Credit',
  'case-g1-destination': 'GST Fundamentals',
  'case-g2-contribution': 'Marginal Costing',
  'case-g2-break-even': 'Cost-Volume-Profit Analysis',
  'case-g2-evidence': 'Audit Evidence',
  'case-g2-representation': 'Written Representations',
  'case-g2-npv': 'Investment Decisions',
  'case-g2-swot': 'Strategic Analysis',
};

const easyIds = new Set([
  'acc-equation', 'acc-accrual', 'law-contract', 'law-offer', 'tax-gst', 'tax-direct',
  'cost-contribution', 'cost-variable', 'audit-sufficiency', 'audit-assurance', 'fm-npv',
  'fm-working-capital', 'sm-swot', 'sm-mission',
]);

const hardIds = new Set([
  'case-g1-asset-ready', 'case-g1-counter-offer', 'case-g1-free-consent', 'case-g1-itc',
  'case-g2-break-even', 'case-g2-evidence', 'case-g2-representation', 'case-g2-npv',
  'case-g2-swot',
]);

export const enrichMcqQuestion = (question: DailyMcqQuestion): EnrichedMcqQuestion => ({
  ...question,
  chapter: chapterById[question.id] || `${question.subject} — General`,
  difficulty: hardIds.has(question.id) ? 'Hard' : easyIds.has(question.id) ? 'Easy' : 'Medium',
  kind: question.kind || 'normal',
});

export const enrichedMcqBank = (questions: DailyMcqQuestion[]) => questions.map(enrichMcqQuestion);
