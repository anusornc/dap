const numRecords = 20000;
const records = [];
for (let i = 0; i < numRecords; i++) {
  records.push({ timestamp: new Date(Date.now() + Math.random() * 100000).toISOString() });
}

let start = performance.now();
for (let i = 0; i < 20; i++) {
  records.slice().sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}
let end = performance.now();
console.log(`With Date(): ${(end - start) / 20} ms`);

start = performance.now();
for (let i = 0; i < 20; i++) {
  records.slice().sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
end = performance.now();
console.log(`With localeCompare(): ${(end - start) / 20} ms`);
