import { migrate } from '../src/db.mjs';
import { runSchedulerJob } from '../src/jobs.mjs';

migrate();
const jobType = process.argv[2] || 'daily';
console.log(JSON.stringify(await runSchedulerJob(jobType), null, 2));
