'use client';
import { CategoryRoutePage } from '@/components/pages/category';
import { useWorkspace } from '@/components/workspace/context';
import { categorySlug } from '@/domain/categories';
import { notFound, useParams } from 'next/navigation';

export default function Page() {
  const { slug } = useParams<{ slug: string }>();
  const { state } = useWorkspace();
  const category = state.categories.find((item) => categorySlug(item.key) === slug);
  if (!category) notFound();
  return <CategoryRoutePage key={category.id} state={state} categoryId={category.id} />;
}
