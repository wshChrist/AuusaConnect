#include "bakkesmod/plugin/bakkesmodplugin.h"
#include <cpr/cpr.h>
#include <nlohmann/json.hpp>

using json = nlohmann::json;

class MatchmakingPlugin : public BakkesMod::Plugin::BakkesModPlugin
{
public:
    void onLoad() override;
    void onUnload() override;

private:
    void HookEvents();
    void OnGameEnd();
};

void MatchmakingPlugin::onLoad()
{
    HookEvents();
}

void MatchmakingPlugin::onUnload()
{
}

void MatchmakingPlugin::HookEvents()
{
    gameWrapper->HookEventPost("Function TAGame.GameEvent_Soccar_TA.EventMatchEnded", std::bind(&MatchmakingPlugin::OnGameEnd, this));
}

void MatchmakingPlugin::OnGameEnd()
{
    ServerWrapper sw = gameWrapper->GetCurrentGameState();
    if (!sw)
        return;

    int scoreBlue = sw.GetTeams().Get(0).GetScore();
    int scoreOrange = sw.GetTeams().Get(1).GetScore();

    json payload = {
        {"scoreBlue", scoreBlue},
        {"scoreOrange", scoreOrange}
    };

    cpr::Response r = cpr::Post(cpr::Url{"http://localhost:3000/match"},
                                cpr::Body{payload.dump()},
                                cpr::Header{{"Content-Type", "application/json"}});
}

BAKKESMOD_PLUGIN(MatchmakingPlugin, "Matchmaking Plugin", "1.0", 0)
