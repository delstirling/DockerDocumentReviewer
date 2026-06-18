CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"action" varchar(255) NOT NULL,
	"details" text,
	"ip_address" varchar(45),
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"token" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"role" varchar(50) DEFAULT 'user' NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"accepted_at" timestamp,
	"expires" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"password" varchar(255),
	"role" varchar(50) DEFAULT 'user' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_approved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;