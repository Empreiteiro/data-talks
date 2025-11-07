-- Create dashboards table for storing user dashboards with chart images
CREATE TABLE public.dashboards (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create dashboard_charts table for storing chart images in dashboards
CREATE TABLE public.dashboard_charts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  dashboard_id UUID NOT NULL REFERENCES public.dashboards(id) ON DELETE CASCADE,
  qa_session_id UUID NOT NULL REFERENCES public.qa_sessions(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  title TEXT,
  description TEXT,
  position_x INTEGER DEFAULT 0,
  position_y INTEGER DEFAULT 0,
  width INTEGER DEFAULT 1,
  height INTEGER DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.dashboards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dashboard_charts ENABLE ROW LEVEL SECURITY;

-- Create indexes for better performance
CREATE INDEX idx_dashboards_user_id ON public.dashboards(user_id);
CREATE INDEX idx_dashboards_organization_id ON public.dashboards(organization_id);
CREATE INDEX idx_dashboard_charts_dashboard_id ON public.dashboard_charts(dashboard_id);
CREATE INDEX idx_dashboard_charts_qa_session_id ON public.dashboard_charts(qa_session_id);

-- RLS Policies for dashboards
CREATE POLICY "Users can view dashboards from their organization"
ON public.dashboards
FOR SELECT
USING (user_belongs_to_organization(auth.uid(), organization_id));

CREATE POLICY "Users can create dashboards in their organization"
ON public.dashboards
FOR INSERT
WITH CHECK (
  auth.uid() = user_id 
  AND user_belongs_to_organization(auth.uid(), organization_id)
);

CREATE POLICY "Users can update dashboards in their organization"
ON public.dashboards
FOR UPDATE
USING (user_belongs_to_organization(auth.uid(), organization_id))
WITH CHECK (user_belongs_to_organization(auth.uid(), organization_id));

CREATE POLICY "Users can delete dashboards in their organization"
ON public.dashboards
FOR DELETE
USING (user_belongs_to_organization(auth.uid(), organization_id));

-- RLS Policies for dashboard_charts
CREATE POLICY "Users can view dashboard charts from their organization"
ON public.dashboard_charts
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.dashboards
    WHERE dashboards.id = dashboard_charts.dashboard_id
      AND user_belongs_to_organization(auth.uid(), dashboards.organization_id)
  )
);

CREATE POLICY "Users can create dashboard charts in their organization"
ON public.dashboard_charts
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.dashboards
    WHERE dashboards.id = dashboard_charts.dashboard_id
      AND user_belongs_to_organization(auth.uid(), dashboards.organization_id)
  )
);

CREATE POLICY "Users can update dashboard charts in their organization"
ON public.dashboard_charts
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.dashboards
    WHERE dashboards.id = dashboard_charts.dashboard_id
      AND user_belongs_to_organization(auth.uid(), dashboards.organization_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.dashboards
    WHERE dashboards.id = dashboard_charts.dashboard_id
      AND user_belongs_to_organization(auth.uid(), dashboards.organization_id)
  )
);

CREATE POLICY "Users can delete dashboard charts in their organization"
ON public.dashboard_charts
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.dashboards
    WHERE dashboards.id = dashboard_charts.dashboard_id
      AND user_belongs_to_organization(auth.uid(), dashboards.organization_id)
  )
);

-- Trigger to automatically set organization_id for dashboards
CREATE OR REPLACE FUNCTION public.set_dashboard_organization_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- If organization_id is not set, get it from the user's organization
  IF NEW.organization_id IS NULL THEN
    NEW.organization_id := user_organization_id(auth.uid());
  END IF;
  
  -- Ensure organization_id is set (required field)
  IF NEW.organization_id IS NULL THEN
    RAISE EXCEPTION 'Cannot determine user organization for dashboard creation';
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger to auto-set organization_id
CREATE TRIGGER set_dashboard_organization_id_trigger
  BEFORE INSERT ON public.dashboards
  FOR EACH ROW
  EXECUTE FUNCTION public.set_dashboard_organization_id();

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_dashboard_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_dashboard_updated_at_trigger
  BEFORE UPDATE ON public.dashboards
  FOR EACH ROW
  EXECUTE FUNCTION public.update_dashboard_updated_at();
