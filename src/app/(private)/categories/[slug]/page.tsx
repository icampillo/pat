import { CategoryRoutePage } from '@/components/pages/category';
import { categorySlug } from '@/domain/categories';
import { notFound } from 'next/navigation';
import { getPrivateData } from '../../_data';
export default async function Page({params}:{params:Promise<{slug:string}>}) {
 const {slug}=await params;const {state}=await getPrivateData();
 const category=state.categories.find(item=>categorySlug(item.key)===slug);
 if(!category)notFound();
 return <CategoryRoutePage key={category.id} state={state} categoryId={category.id}/>;
}
