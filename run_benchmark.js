import { spawn } from 'child_process';

const run = () => {
    const p = spawn('node', ['benchmark.js'], { stdio: 'inherit' });
    p.on('exit', (code) => {
        console.log(`Process exited with code ${code}`);
    });
};
run();
