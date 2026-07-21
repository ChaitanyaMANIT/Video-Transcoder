import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const videos = await prisma.video.findMany();
  console.log("Database connected successfully! Videos found:", videos.length);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
