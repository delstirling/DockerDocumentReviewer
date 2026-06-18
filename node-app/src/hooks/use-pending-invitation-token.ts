import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useToast } from "@/hooks/use-toast";

/**
 * Hook to process pending invitation tokens stored in localStorage
 * after OAuth signup. Automatically assigns the user to the organization
 * from the invitation token.
 */
export function usePendingInvitationToken() {
  const { data: session, status } = useSession();
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);
  const [hasProcessed, setHasProcessed] = useState(false);

  useEffect(() => {
    async function processPendingInvitation() {
      if (status !== "authenticated" || !session?.user?.id) {
        return;
      }

      if (hasProcessed) {
        return;
      }

      if (typeof window === "undefined") {
        return;
      }

      const token = localStorage.getItem("pendingInvitationToken");
      if (!token) {
        return;
      }

      setIsProcessing(true);
      setHasProcessed(true);

      try {
        const response = await fetch("/api/organization/process-invitation", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ token }),
        });

        const data = await response.json();

        if (!response.ok) {
          console.error("Failed to process invitation:", data.error);
          toast({
            title: "Invitation Processing",
            description: data.error || "Failed to process invitation",
            variant: "destructive",
          });
          return;
        }

        localStorage.removeItem("pendingInvitationToken");

        toast({
          title: "Welcome!",
          description: "You have been successfully added to the organization.",
        });
      } catch (error) {
        console.error("Error processing pending invitation:", error);
        toast({
          title: "Error",
          description: "Failed to process invitation token",
          variant: "destructive",
        });
      } finally {
        setIsProcessing(false);
      }
    }

    processPendingInvitation();
  }, [session?.user?.id, status, hasProcessed, toast]);

  return { isProcessing, hasProcessed };
}
