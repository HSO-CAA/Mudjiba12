import { Compass } from 'lucide-react';
import { ButtonLink } from '../ui/button';
import { EmptyState } from '../ui/misc';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';

export default function NotFound() {
  useDocumentTitle('غير موجود');
  return (
    <EmptyState
      icon={<Compass />}
      title="المشهد مو موجود"
      description="الرابط اللي فتحته مو موجود باللوحة."
      action={
        <ButtonLink to="/" variant="primary">
          رجوع للنظرة العامة
        </ButtonLink>
      }
    />
  );
}
