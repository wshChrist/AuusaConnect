#include "bakkesmod/plugin/bakkesmodplugin.h"
#include <cpr/cpr.h>
#include <nlohmann/json.hpp>
#include <vector>
#include <string>

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

    ArrayWrapper<PriWrapper> pris = sw.GetPRIs();
    json players = json::array();
    json scorers = json::array();
    std::string mvp = "";
    int bestScore = -1;

    for (int i = 0; i < pris.Count(); ++i)
    {
        PriWrapper pri = pris.Get(i);
        if (!pri)
            continue;

        json p = {
            {"name", pri.GetPlayerName().ToString()},
            {"team", pri.GetTeamNum2()},
            {"goals", pri.GetGoals()},
            {"saves", pri.GetSaves()},
            {"score", pri.GetMatchScore()}
        };
        players.push_back(p);

        if (pri.GetGoals() > 0)
            scorers.push_back(pri.GetPlayerName().ToString());

        if (pri.GetMatchScore() > bestScore)
        {
            bestScore = pri.GetMatchScore();
            mvp = pri.GetPlayerName().ToString();
        }
    }

    json payload = {
        {"scoreBlue", scoreBlue},
        {"scoreOrange", scoreOrange},
        {"scorers", scorers},
        {"mvp", mvp},
        {"players", players}
    };

    cpr::Response r = cpr::Post(cpr::Url{"http://localhost:3000/match"},
                                cpr::Body{payload.dump()},
                                cpr::Header{{"Content-Type", "application/json"}});
}

BAKKESMOD_PLUGIN(MatchmakingPlugin, "Matchmaking Plugin", "1.0", 0)
