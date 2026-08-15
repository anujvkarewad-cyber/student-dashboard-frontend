import { DailyMcqQuestion } from './dailyMcqBank';
import { officialMcqChapterById, OfficialMcqChapter } from './icaiChapterCatalog';

export type McqDifficulty = 'Easy' | 'Medium' | 'Hard';

export type EnrichedMcqQuestion = DailyMcqQuestion & {
  chapterId: string;
  chapter: string;
  chapterTitle: string;
  chapterNumber: number;
  chapterModule: string;
  chapterSection?: string;
  chapterOrder: number;
  officialChapter: OfficialMcqChapter;
  difficulty: McqDifficulty;
  kind: 'normal' | 'case-study';
};

// Each value is a canonical ID from the ICAI BoS May 2026 chapter catalogue.
// There is intentionally no generic fallback: a missing or cross-subject mapping
// must fail validation instead of showing students a guessed topic label.
const chapterIdByQuestionId: Record<string, string> = {
  'acc-equation': 'advanced-accounting-1',
  'acc-accrual': 'advanced-accounting-2',
  'acc-depreciation': 'advanced-accounting-5',
  'acc-trial-balance': 'advanced-accounting-3',
  'law-contract': 'corporate-laws-1',
  'law-consent': 'corporate-laws-2',
  'law-offer': 'corporate-laws-4',
  'law-consideration': 'other-laws-1',
  'tax-gst': 'gst-1',
  'tax-itc': 'gst-8',
  'tax-direct': 'income-tax-1',
  'tax-year': 'income-tax-1',
  'cost-contribution': 'costing-14',
  'cost-bep': 'costing-14',
  'cost-mos': 'costing-14',
  'cost-variable': 'costing-14',
  'audit-sufficiency': 'audit-4',
  'audit-appropriateness': 'audit-4',
  'audit-assurance': 'audit-1',
  'audit-skepticism': 'audit-1',
  'fm-npv': 'financial-management-7',
  'fm-discount': 'financial-management-7',
  'fm-working-capital': 'financial-management-9',
  'fm-irr': 'financial-management-7',
  'sm-swot': 'strategic-management-3',
  'sm-mission': 'strategic-management-1',
  'sm-cost-leadership': 'strategic-management-3',
  'sm-strategy': 'strategic-management-1',
  'case-g1-asset-ready': 'advanced-accounting-5',
  'case-g1-trial-error': 'advanced-accounting-4',
  'case-g1-counter-offer': 'corporate-laws-2',
  'case-g1-free-consent': 'other-laws-1',
  'case-g1-itc': 'gst-8',
  'case-g1-destination': 'gst-4',
  'case-g2-contribution': 'costing-14',
  'case-g2-break-even': 'costing-14',
  'case-g2-evidence': 'audit-4',
  'case-g2-representation': 'audit-7',
  'case-g2-npv': 'financial-management-7',
  'case-g2-swot': 'strategic-management-3',
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

export const enrichMcqQuestion = (question: DailyMcqQuestion): EnrichedMcqQuestion => {
  const chapterId = chapterIdByQuestionId[question.id];
  const officialChapter = officialMcqChapterById[chapterId];
  if (!officialChapter) throw new Error(`Question ${question.id} has no verified ICAI May 2026 chapter mapping.`);
  if (officialChapter.subject !== question.subject) throw new Error(`Question ${question.id} is mapped across subjects.`);

  return {
    ...question,
    chapterId,
    chapter: officialChapter.displayTitle,
    chapterTitle: officialChapter.officialTitle,
    chapterNumber: officialChapter.chapterNumber,
    chapterModule: officialChapter.module,
    chapterSection: officialChapter.section,
    chapterOrder: officialChapter.catalogOrder,
    officialChapter,
    difficulty: hardIds.has(question.id) ? 'Hard' : easyIds.has(question.id) ? 'Easy' : 'Medium',
    kind: question.kind || 'normal',
  };
};

export const enrichedMcqBank = (questions: DailyMcqQuestion[]) => questions.map(enrichMcqQuestion);

export const validateMcqChapterMappings = (questions: DailyMcqQuestion[]) => {
  const questionIds = new Set(questions.map((question) => question.id));
  const staleMappings = Object.keys(chapterIdByQuestionId).filter((id) => !questionIds.has(id));
  if (staleMappings.length) throw new Error(`Stale MCQ chapter mappings: ${staleMappings.join(', ')}`);
  return questions.map(enrichMcqQuestion);
};
