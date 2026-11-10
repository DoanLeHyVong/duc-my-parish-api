const response = await globalThis.fetch('http://127.0.0.1:5000/api/v1/ready');
if (!response.ok) globalThis.process.exit(1);
