import { seedE2eDb } from './seed';

export default async function globalSetup() {
  await seedE2eDb();
}
