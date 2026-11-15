import { z } from 'zod';
import { EndCallArgs, RecordConsentArgs, RecordMarkerArgs } from '../tools.ts';

function declaration(name: string, description: string, schema: z.ZodType) {
  const { $schema: _, ...parametersJsonSchema } = z.toJSONSchema(schema) as Record<string, unknown>;
  return { name, description, parametersJsonSchema };
}

// Gemini function declarations; each tool is served at POST /tools/<name> on the Fastify service.
export const functionDeclarations = [
  declaration(
    'record_consent',
    'Call once, after the person said they are 18 or older and agreed you may save what they share. Nothing can be saved before this returns ok.',
    RecordConsentArgs,
  ),
  declaration(
    'record_marker',
    'Save one fact about the person as soon as they state it. Use only marker keys from your instructions.',
    RecordMarkerArgs,
  ),
  declaration(
    'end_call',
    'Call once, just before the call ends, with a short summary of who they are and who they want to meet.',
    EndCallArgs,
  ),
];
