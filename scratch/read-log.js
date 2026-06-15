import fs from 'fs';
import readline from 'readline';

async function searchLog() {
  const fileStream = fs.createReadStream('C:\\Users\\PC\\.gemini\\antigravity\\brain\\f24de61d-c9d4-4a3d-8e7e-ecb55f9b00df\\.system_generated\\logs\\transcript.jsonl');

  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    const obj = JSON.parse(line);
    if (obj.step_index === 347) {
      console.log(obj.content);
    }
  }
}

searchLog().catch(console.error);
