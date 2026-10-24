import type { EvaluateInput, EvaluationOutcome } from './answerEvaluator';
import { practiceJson } from './practiceTools';

/** Explicitly opted-in processing only. No shared mark/revision persistence. */
export async function evaluatePrivateReceipt(input: EvaluateInput): Promise<EvaluationOutcome> {
  try {
    const result = await practiceJson('/receipt/evaluate', {
      question: input.question, studentAnswer: input.studentAnswer,
      subject: input.subject || '', concept: input.concept || '', confirmed: true,
    });
    if (result.ok !== true || result.receiptStored !== false || result.scoreStored !== false || !Number.isFinite(result.score)) {
      return { ok: false, mode: 'unavailable', error: 'Private feedback is unavailable. Your local receipt is unchanged.' };
    }
    return { ...result, ok: true, mode: 'graded', missingKeyPoints: result.missingKeyPoints || [] };
  } catch {
    return { ok: false, mode: 'unavailable', error: 'Private feedback is unavailable. Your local receipt is unchanged.' };
  }
}
