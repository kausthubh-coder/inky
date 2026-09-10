import { cronJobs } from "convex/server";
import { internal } from "./_generated/api.js";

const crons = cronJobs();
crons.interval("Reconcile Clerk beta admissions", { minutes: 5 }, internal.accessSync.reconcileAccounts, { cursor: null });
export default crons;
