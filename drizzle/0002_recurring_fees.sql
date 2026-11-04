CREATE TABLE "recurring_fees" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"amount" bigint NOT NULL,
	"account_id" integer NOT NULL,
	"category_id" integer,
	"day_of_month" integer NOT NULL,
	"start_month" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recurring_fees" ADD CONSTRAINT "recurring_fees_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_fees" ADD CONSTRAINT "recurring_fees_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;