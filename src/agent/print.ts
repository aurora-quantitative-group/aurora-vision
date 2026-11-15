import { functionDeclarations } from './declarations.ts';
import { systemPrompt } from './system-prompt.ts';

console.log('=== Gemini function declarations ===');
console.log(JSON.stringify(functionDeclarations, null, 2));
console.log('\n=== System prompt ===');
console.log(systemPrompt());
