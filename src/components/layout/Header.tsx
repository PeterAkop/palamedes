import { Scale } from 'lucide-react';
import Link from 'next/link';

export default function Header() {
  return (
    <div className="navbar bg-base-100 shadow-sm border-b">
      <div className="navbar-start">
        <Link href="/" className="btn btn-ghost text-xl gap-2">
          <Scale className="h-6 w-6 text-primary" />
          <span className="font-bold">Palamedes</span>
        </Link>
      </div>
    </div>
  );
}
