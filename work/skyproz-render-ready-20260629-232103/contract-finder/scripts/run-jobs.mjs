import { migrate } from '../src/db.mjs';
import { runDailyJobs } from '../src/jobs.mjs';

migrate();
console.log(JSON.stringify(await runDailyJobs(), null, 2));
