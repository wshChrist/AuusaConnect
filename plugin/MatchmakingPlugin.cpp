#include "bakkesmod/plugin/bakkesmodplugin.h"
#include <cpr/cpr.h>
#include <nlohmann/json.hpp>
#include <vector>
#include <string>

using json = nlohmann::json;

struct PlayerStats
{
    int boostPickups = 0;
    int wastedBoosts = 0;
    int smallPads = 0;
    int bigPads = 0;
    float lastBoost = -1.f;
};

class MatchmakingPlugin : public BakkesMod::Plugin::BakkesModPlugin
{
public:
    void onLoad() override;
    void onUnload() override;

private:
    void HookEvents();
    void OnMatchStart(ServerWrapper server);
    void TickBoost();
    void OnGameEnd();

    std::map<std::string, PlayerStats> stats;
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
    gameWrapper->HookEventWithCallerPost<ServerWrapper>(
        "Function TAGame.GameEvent_Soccar_TA.EventMatchStarted",
        std::bind(&MatchmakingPlugin::OnMatchStart, this, std::placeholders::_1));
    gameWrapper->HookEventPost(
        "Function TAGame.GameEvent_Soccar_TA.EventMatchEnded",
        std::bind(&MatchmakingPlugin::OnGameEnd, this));
}

void MatchmakingPlugin::OnMatchStart(ServerWrapper server)
{
    stats.clear();
    TickBoost();
}

void MatchmakingPlugin::TickBoost()
{
    ServerWrapper sw = gameWrapper->GetCurrentGameState();
    if (sw)
    {
        ArrayWrapper<PriWrapper> pris = sw.GetPRIs();
        for (int i = 0; i < pris.Count(); ++i)
        {
            PriWrapper pri = pris.Get(i);
            if (!pri)
                continue;

            std::string name = pri.GetPlayerName().ToString();
            CarWrapper car = pri.GetCar();
            if (!car)
                continue;
            BoostWrapper boost = car.GetBoostComponent();
            if (!boost)
                continue;

            PlayerStats &ps = stats[name];
            float current = boost.GetCurrentBoostAmount();
            if (ps.lastBoost >= 0 && current - ps.lastBoost > 1.f)
            {
                ps.boostPickups++;
                if (ps.lastBoost >= boost.GetMaxBoostAmount() * 0.8f)
                    ps.wastedBoosts++;
                if (current - ps.lastBoost > 90.f)
                    ps.bigPads++;
                else
                    ps.smallPads++;
            }
            ps.lastBoost = current;
        }
    }
    gameWrapper->SetTimeout(std::bind(&MatchmakingPlugin::TickBoost, this), 0.1f);
}

void MatchmakingPlugin::OnGameEnd()
{
    ServerWrapper sw = gameWrapper->GetCurrentGameState();
    if (!sw)
        return;

    TeamWrapper blueTeam = sw.GetTeams().Get(0);
    TeamWrapper orangeTeam = sw.GetTeams().Get(1);

    int scoreBlue = blueTeam.GetScore();
    int scoreOrange = orangeTeam.GetScore();

    std::string blueName = blueTeam.GetTeamName().ToString();
    std::string orangeName = orangeTeam.GetTeamName().ToString();

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

        std::string pname = pri.GetPlayerName().ToString();
        PlayerStats ps = stats[pname];
        float totalTime = sw.GetGameEventAsServer().GetTotalGameTimePlayed();
        json p = {
            {"name", pname},
            {"team", pri.GetTeamNum2()},
            {"goals", pri.GetMatchGoals()},
            {"assists", pri.GetMatchAssists()},
            {"shots", pri.GetMatchShots()},
            {"saves", pri.GetMatchSaves()},
            {"score", pri.GetMatchScore()},
            {"boostPickups", ps.boostPickups},
            {"wastedBoostPickups", ps.wastedBoosts},
            {"boostFrequency", totalTime > 0 ? ps.boostPickups / totalTime : 0},
            {"rotationQuality", ps.boostPickups > 0 ? (float)ps.smallPads / ps.boostPickups : 0}
        };
        players.push_back(p);

        if (pri.GetMatchGoals() > 0)
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
        {"teamBlue", blueName},
        {"teamOrange", orangeName},
        {"scorers", scorers},
        {"mvp", mvp},
        {"players", players}
    };

    cpr::Response r = cpr::Post(cpr::Url{"http://localhost:3000/match"},
                                cpr::Body{payload.dump()},
                                cpr::Header{{"Content-Type", "application/json"}});
}

BAKKESMOD_PLUGIN(MatchmakingPlugin, "Matchmaking Plugin", "1.0", 0)
