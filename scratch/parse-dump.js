import fs from 'fs';

const path = 'C:\\Users\\PC\\.gemini\\antigravity\\brain\\33bd377c-3ad4-4f11-b3c1-789c513e4612\\.system_generated\\steps\\5406\\content.md';
const content = fs.readFileSync(path, 'utf8');

const jsonLine = content.split('\n').find(line => line.trim().startsWith('{"comercios":'));

if (jsonLine) {
  const data = JSON.parse(jsonLine);
  console.log('--- COMERCIOS ---');
  data.comercios.forEach(c => {
    console.log(`ID: ${c.id} | Name: ${c.name} | OwnerId: ${c.ownerId}`);
  });

  console.log('\n--- USERS ---');
  data.users.forEach(u => {
    if (['7mdgE7txSCQqWQl1Hzrqa5PCo8C2', '8RE6gOGXhJOnGJei2AqGrHYb4Mq2', 'Bvcm2PxTXGfzMrOj982IjbkSQhl1', 'Pq4VPt63A5Z4zSMApoxwAf2Thvu1', 'xcGGZhmZAha71StCqGDWxfpsdCT2', '7Sq9bA7OGuegcowu2ASktLm05og2'].includes(u.id)) {
      console.log(`UID: ${u.id} | Email: ${u.email} | Role: ${u.role} | Name: ${u.displayName}`);
    }
  });
} else {
  console.log('No JSON line found.');
}
