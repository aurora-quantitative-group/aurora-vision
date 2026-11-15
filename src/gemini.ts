import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { EMBEDDING_DIMS } from './config.ts';
import type { Config } from './config.ts';

export class Gemini {
  private readonly ai: GoogleGenAI;
  private readonly model: string;
  private readonly embeddingModel: string;

  constructor(config: Pick<Config, 'GOOGLE_API_KEY' | 'GEMINI_MODEL' | 'EMBEDDING_MODEL'>) {
    this.ai = new GoogleGenAI({ apiKey: config.GOOGLE_API_KEY });
    this.model = config.GEMINI_MODEL;
    this.embeddingModel = config.EMBEDDING_MODEL;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const response = await this.ai.models.embedContent({
      model: this.embeddingModel,
      contents: texts,
      config: { outputDimensionality: EMBEDDING_DIMS, taskType: 'SEMANTIC_SIMILARITY' },
    });
    const vectors = (response.embeddings ?? []).map(e => e.values ?? []);
    if (vectors.length !== texts.length || vectors.some(v => v.length !== EMBEDDING_DIMS)) throw new Error('Gemini returned unexpected embeddings');
    return vectors;
  }

  async json<T>(prompt: string, schema: z.ZodType<T>): Promise<T> {
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: prompt,
      config: { responseMimeType: 'application/json', responseJsonSchema: z.toJSONSchema(schema), temperature: 0.4 },
    });
    return schema.parse(JSON.parse(response.text ?? ''));
  }
}
