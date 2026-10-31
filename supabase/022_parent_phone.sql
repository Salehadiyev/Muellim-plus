-- Valideyn nömrəsi yalnız müəllimə və onun aktiv ödəniş köməkçisinə açılır.
alter table public.students add column if not exists parent_phone text;
alter table public.students drop constraint if exists students_parent_phone_check;
alter table public.students add constraint students_parent_phone_check check (parent_phone is null or parent_phone ~ '^\+[1-9][0-9]{7,14}$');

create or replace function public.payment_assistant_ledger(p_month date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare owner_id uuid; result jsonb; start_month date;
begin
 select a.teacher_id into owner_id from payment_assistants a join teacher_access t on t.user_id=a.teacher_id where a.user_id=auth.uid() and a.active and t.approved;
 if owner_id is null then raise exception 'Giriş icazəsi yoxdur'; end if;
 if p_month is null or p_month<>date_trunc('month',p_month)::date or p_month<date '2000-01-01' or p_month>date '2100-01-01' then raise exception 'Ay düzgün deyil'; end if;
 start_month:=date_trunc('month',now() at time zone 'Asia/Baku')::date;
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.full_name,'parent_phone',s.parent_phone,'class_name',c.name,'monthly_fee',s.lesson_price,'pay_day',s.pay_day,
 'next_month',(coalesce(date_trunc('month',s.billing_start)::date,start_month)+make_interval(months=>case when s.lesson_price>0 then least(1200,floor(p.total/s.lesson_price))::int else 0 end))::date,
 'remaining',case when s.lesson_price>0 then s.lesson_price-mod(p.total,s.lesson_price) else 0 end,
 'lessons',(select coalesce(jsonb_agg(jsonb_build_object('date',l.lesson_date,'status',l.status,'topic',l.topic) order by l.lesson_date desc),'[]'::jsonb) from lessons l where l.teacher_id=owner_id and l.student_id=s.id and l.lesson_date>=p_month and l.lesson_date<(p_month+interval '1 month'))
 ) order by s.full_name),'[]'::jsonb) into result
 from students s join classes c on c.id=s.class_id
 cross join lateral(select coalesce(sum(amount),0)::numeric as total from payments where teacher_id=owner_id and student_id=s.id) p
 where c.teacher_id=owner_id;
 return jsonb_build_object('students',result);
end;
$$;

revoke all on function public.payment_assistant_ledger(date) from public, anon;
grant execute on function public.payment_assistant_ledger(date) to authenticated;
