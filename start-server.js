const { exec } = require('child_process');
const path = require('path');

const serverPath = path.join(__dirname, 'packages', 'server', 'src', 'index.ts');

console.log('Starting Hive server...');
const child = exec(`npx tsx "${serverPath}"`, {
  cwd: __dirname,
  shell: true,
});

child.stdout.on('data', (data) => {
  console.log(data.toString());
});

child.stderr.on('data', (data) => {
  console.error(data.toString());
});

child.on('close', (code) => {
  console.log(`Server exited with code ${code}`);
});
