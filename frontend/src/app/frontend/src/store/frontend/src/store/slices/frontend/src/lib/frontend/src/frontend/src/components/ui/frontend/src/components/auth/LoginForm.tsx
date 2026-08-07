'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useDispatch, useSelector } from 'react-redux';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AppDispatch, RootState } from '@/store';
import { login } from '@/store/slices/authSlice';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { toast } from 'react-hot-toast';

const loginSchema = z.object({
  email: z.string().email('البريد الإلكتروني غير صحيح'),
  password: z.string().min(6, 'كلمة المرور يجب أن تكون 6 أحرف على الأقل'),
});

type LoginFormData = z.infer<typeof loginSchema>;

export function LoginForm() {
  const dispatch = useDispatch<AppDispatch>();
  const router = useRouter();
  const { isLoading } = useSelector((state: RootState) => state.auth);
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginFormData) => {
    try {
      const result = await dispatch(login(data)).unwrap();
      toast.success('مرحباً بعودتك!');
      router.push('/feed');
    } catch (error) {
      toast.error(typeof error === 'string' ? error : 'فشل تسجيل الدخول');
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 w-full max-w-md">
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-blue-600 bg-clip-text text-transparent">
          A.K
        </h1>
        <p className="text-muted-foreground">مرحباً بعودتك! سجل الدخول إلى حسابك</p>
      </div>

      <Input
        label="البريد الإلكتروني"
        type="email"
        placeholder="example@email.com"
        error={errors.email?.message}
        {...register('email')}
      />

      <Input
        label="كلمة المرور"
        type="password"
        placeholder="••••••••"
        error={errors.password?.message}
        {...register('password')}
      />

      <div className="flex items-center justify-between">
        <label className="flex items-center space-x-2 text-sm">
          <input type="checkbox" className="rounded border-input" />
          <span>تذكرني</span>
        </label>
        <Link
          href="/forgot-password"
          className="text-sm text-primary hover:underline transition-colors"
        >
          نسيت كلمة المرور؟
        </Link>
      </div>

      <Button type="submit" className="w-full" size="lg" loading={isLoading}>
        تسجيل الدخول
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        ليس لديك حساب؟{' '}
        <Link href="/register" className="text-primary hover:underline font-medium">
          إنشاء حساب جديد
        </Link>
      </p>
    </form>
  );
}
