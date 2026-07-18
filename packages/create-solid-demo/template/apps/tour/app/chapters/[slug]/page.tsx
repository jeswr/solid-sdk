import { ShowcaseChapterPage } from "@jeswr/solid-showcase";
import { notFound } from "next/navigation";
import { walkthrough } from "../../../lib/walkthrough";

export function generateStaticParams() {
  return walkthrough.chapters.map((chapter) => ({ slug: chapter.slug }));
}

export default async function ChapterPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!walkthrough.chapters.some((chapter) => chapter.slug === slug)) notFound();
  return <ShowcaseChapterPage document={walkthrough} slug={slug} />;
}
