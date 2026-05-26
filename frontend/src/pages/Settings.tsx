import { Link, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import {
  Shield, UserPlus, Globe, Users, Plus, Layers, ArrowRight,
} from 'lucide-react';

const Settings = () => {
  const { currentWorkspace, environment, setEnvironment, teams } = useWorkspace();
  const [searchParams, setSearchParams] = useSearchParams();

  const tab = searchParams.get('tab') || 'general';
  const setTab = (v: string) => {
    const next = new URLSearchParams(searchParams);
    if (v === 'general') next.delete('tab'); else next.set('tab', v);
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Workspace Settings</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{currentWorkspace.name}</p>
        </div>
        <Button size="sm"><UserPlus className="h-3.5 w-3.5 mr-1" /> Invite Member</Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-8">
          <TabsTrigger value="general" className="text-xs h-7">General</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-6 mt-4">
          {/* Taxonomy admin entry point */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Layers className="h-4 w-4 text-muted-foreground" /> Taxonomy
              </CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Rename, merge, or retire modules, features, releases, processes, and labels. Soft-delete only.
              </p>
              <Button asChild size="sm" variant="outline" className="text-xs h-8">
                <Link to="/settings/taxonomy">Open Taxonomy <ArrowRight className="h-3 w-3 ml-1" /></Link>
              </Button>
            </CardContent>
          </Card>

          {/* Environment Config */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Globe className="h-4 w-4 text-muted-foreground" /> Environment Configuration
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium mb-1.5 block">Active Environment</label>
                  <Select value={environment} onValueChange={(v) => setEnvironment(v as 'dev' | 'qa' | 'uat')}>
                    <SelectTrigger className="w-[200px] h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dev" className="text-xs">Development</SelectItem>
                      <SelectItem value="qa" className="text-xs">QA</SelectItem>
                      <SelectItem value="uat" className="text-xs">UAT</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-xs text-muted-foreground">
                  The active environment determines which configuration is used for new test runs.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Teams */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" /> Teams
                </CardTitle>
                <Button size="sm" variant="outline" className="text-xs h-7">
                  <Plus className="h-3 w-3 mr-1" /> Create Team
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {teams.map((team) => (
                  <div key={team.id} className="p-3 border rounded-lg space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: team.color }} />
                        <span className="text-sm font-medium">{team.name}</span>
                      </div>
                      <Badge variant="secondary" className="text-[10px]">{team.members.length} members</Badge>
                    </div>
                    {team.description && (
                      <p className="text-[11px] text-muted-foreground">{team.description}</p>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      {team.members.map((m) => (
                        <div key={m.userId} className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/50 text-[11px]">
                          <div className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center text-[9px] font-medium text-primary">
                            {m.name.split(' ').map(n => n[0]).join('')}
                          </div>
                          <span>{m.name}</span>
                          <Badge variant="outline" className="text-[9px] h-4 px-1">{m.role}</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Workspace Members */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Shield className="h-4 w-4 text-muted-foreground" /> Workspace Members
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {currentWorkspace.members.map((member) => (
                  <div key={member.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary">
                        {member.name.split(' ').map(n => n[0]).join('')}
                      </div>
                      <div>
                        <div className="text-sm font-medium">{member.name}</div>
                        <div className="text-[11px] text-muted-foreground">{member.email}</div>
                      </div>
                    </div>
                    <Select defaultValue={member.role}>
                      <SelectTrigger className="w-[120px] h-7 text-xs border-none">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="owner" className="text-xs">Owner</SelectItem>
                        <SelectItem value="contributor" className="text-xs">Contributor</SelectItem>
                        <SelectItem value="operator" className="text-xs">Operator</SelectItem>
                        <SelectItem value="viewer" className="text-xs">Viewer</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Role Permissions */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Role Permissions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-xs">
                {[
                  { role: 'Owner', perms: 'Full access — manage workspace, members, and all resources' },
                  { role: 'Contributor', perms: 'Create and edit test cases, steps, and configurations' },
                  { role: 'Operator', perms: 'Execute test runs and view results' },
                  { role: 'Viewer', perms: 'Read-only access to all resources' },
                ].map(({ role, perms }) => (
                  <div key={role} className="flex items-start gap-2 p-2 rounded border">
                    <Badge variant="secondary" className="text-[10px] shrink-0">{role}</Badge>
                    <span className="text-muted-foreground">{perms}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Settings;
