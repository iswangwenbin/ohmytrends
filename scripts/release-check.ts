const forbidden = [
  {
    pattern: /\.\.\/node_modules|node_modules\//,
    message: "Do not import files through node_modules paths; package managers may hoist dependencies.",
  },
];

const files = [
  ...(await Array.fromAsync(new Bun.Glob("src/**/*.{ts,css}").scan())),
  ...(await Array.fromAsync(new Bun.Glob("tests/**/*.ts").scan())),
  "package.json",
];

const failures: string[] = [];
for (const file of files) {
  const text = await Bun.file(file).text();
  for (const rule of forbidden) {
    if (rule.pattern.test(text)) {
      failures.push(`${file}: ${rule.message}`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
